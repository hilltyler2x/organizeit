import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isBannedCategoryName, pickCategoryName } from "../src/core/categories";
import type { Classification, Section } from "../src/core/types";

// Two passes keep the AI bill low: every photo goes to a fast, cheap model first, and only the
// ones it isn't sure about (or can't place) are asked again of the most capable model. Both can
// be switched on the server without a new app build; CLASSIFY_ESCALATE_MODEL=none turns the
// second pass off.
export const MODEL = process.env.CLASSIFY_MODEL || "claude-haiku-5-5";
const escalateSetting = process.env.CLASSIFY_ESCALATE_MODEL ?? "claude-opus-5-5";
export const ESCALATE_MODEL = escalateSetting && escalateSetting !== "none" && escalateSetting !== MODEL ? escalateSetting : null;
/** First-pass answers below this confidence go to the second model. */
export const ESCALATE_BELOW = Number(process.env.CLASSIFY_ESCALATE_BELOW ?? 0.75);
// Haiku has no server-side refusal fallback; the other current models do.
const hasFallbacks = (model: string) => !model.startsWith("claude-haiku");

// Up to this many photos go to the AI in one request. One request per photo spends most of
// its time on per-request overhead, so batches sort several times faster.
export const MAX_BATCH = 8;

const PhotoInput = z.object({
  image: z.string().min(1), // base64, no data: prefix
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  fileName: z.string().max(300).default(""),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  isScreenshot: z.boolean().default(false),
  // A video arrives as one image holding four frames from across the clip.
  isVideo: z.boolean().default(false),
  durationSec: z.number().nonnegative().max(1_000_000).optional(),
});
type PhotoInput = z.infer<typeof PhotoInput>;

const Context = z.object({
  categories: z
    .array(z.object({ section: z.enum(["business", "products", "personal"]), name: z.string().max(80) }))
    .max(500),
  // The person's own corrections, newest first, so the AI learns their categories.
  lessons: z
    .array(
      z.object({
        label: z.string().max(120),
        section: z.enum(["business", "products", "personal"]),
        category: z.string().max(80),
        wrong: z.string().max(80).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export const ClassifyRequest = PhotoInput.extend(Context.shape);
export type ClassifyRequest = z.infer<typeof ClassifyRequest>;

export const ClassifyBatchRequest = Context.extend({ photos: z.array(PhotoInput).min(1).max(MAX_BATCH) });
export type ClassifyBatchRequest = z.infer<typeof ClassifyBatchRequest>;

const ModelAnswer = z.object({
  section: z.enum(["business", "products", "personal"]),
  category: z.string(),
  label: z.string(),
  confidence: z.number(),
});

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["section", "category", "label", "confidence"],
  properties: {
    section: { type: "string", enum: ["business", "products", "personal"] },
    category: { type: "string", description: "Existing category name, or a new specific plural name" },
    label: { type: "string", description: "Short description of the main item or document, e.g. 'Nike Dunk Low sneaker'" },
    confidence: { type: "number", description: "0 to 1" },
  },
} as const;

const BATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photo", ...OUTPUT_SCHEMA.required],
        properties: { photo: { type: "integer", description: "The photo's number" }, ...OUTPUT_SCHEMA.properties },
      },
    },
  },
} as const;

const SYSTEM = `You sort photos from a reseller's camera roll for an app called OrganizeIt.

Pick one section:
- "business": business expense records. Receipts (paper or digital), order confirmations, invoices, payment or checkout screens, payment app transfers, shipping label purchases, subscription charges. Usually screenshots or photos of documents.
- "products": photos of items being resold or inventoried. Product shots, flat lays, items on hangers or tables, tags and labels of an item.
- "personal": anything else (people, pets, places, food, memes, non-expense screenshots).

Then pick one category inside that section:
- Reuse an existing category when the photo fits it. Use the exact existing name.
- If nothing fits, invent a new category: a short, specific, plural Title Case name for the kind of item or document (for example Sneakers, Sunglasses, Jewelry, Phone Cases, Hoodies, Shipping Labels, Pets, Food).
- Never answer with a catch-all such as Other, Misc, Miscellaneous, Uncategorized, Unknown, General, Assorted, or Various, and never prefix a name with them. Even when unsure, name the most specific kind of thing you can see.
- Product categories are by item type, not brand or color.

Some items are videos. A video is shown as one image with four frames taken across the clip, in a 2x2 grid in time order (left to right, then top to bottom). Sort a video by what the clip as a whole shows, into the same sections and categories as photos: a video of a sneaker goes in Sneakers, a screen recording of a checkout goes in business. Don't make a category just because something is a video (never Videos, Clips or Screen Recordings).

The label is a few words describing the specific thing shown.

Your answer is filed automatically: sorting the whole camera roll without the person's help is the point of the app, so commit to the best answer. When a photo could fit two categories, pick the more likely one; when it isn't clear whether a screenshot is a business expense, decide from what it shows; when nothing existing fits, make a new specific category. Confidence is between 0 and 1. Give 0.5 to 0.75 for such close calls, and higher when it's plain. Only give below 0.3 when you truly can't make out what the photo shows (black, blank, or blurred beyond recognition); just those few are handed to the person to check. Even then, give your best specific guess.

You may be given corrections the person made to earlier sorts. They show how this person wants things filed and outrank your own judgement: when a photo looks like one of those items, use the category they chose, and avoid the mistake that was corrected.`;

function categoryList(categories: ClassifyRequest["categories"]): string {
  const by: Record<Section, string[]> = { business: [], products: [], personal: [] };
  for (const c of categories) if (!isBannedCategoryName(c.name)) by[c.section].push(c.name);
  return (Object.keys(by) as Section[])
    .map((s) => `${s}: ${by[s].length ? by[s].join(", ") : "(none yet)"}`)
    .join("\n");
}

function lessonList(lessons: ClassifyRequest["lessons"]): string {
  const usable = lessons.filter((l) => !isBannedCategoryName(l.category));
  if (!usable.length) return "";
  const lines = usable.map((l) => `- "${l.label}" → ${l.section} / ${l.category}${l.wrong ? ` (not ${l.wrong})` : ""}`);
  return `Corrections this person made to earlier photos:\n${lines.join("\n")}\n\n`;
}

function hints(req: PhotoInput): string {
  const parts: string[] = [];
  if (req.fileName) parts.push(`File name: ${req.fileName}`);
  if (req.width && req.height) parts.push(`Original size: ${req.width}x${req.height}`);
  if (req.isScreenshot) parts.push("The phone marked this photo as a screenshot.");
  if (req.isVideo) {
    const length = req.durationSec ? ` (${Math.round(req.durationSec)} seconds long)` : "";
    parts.push(`This is a video${length}. The image shows four frames from across it in a 2x2 grid.`);
  }
  return parts.join("\n");
}

export class ClassifyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

type Messages = Anthropic.Beta.Messages.BetaMessageParam[];

async function request(client: Anthropic, model: string, messages: Messages, schema: { [key: string]: unknown }, maxTokens: number) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    ...(hasFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages,
  });
  if (response.stop_reason === "refusal") throw new ClassifyError("The AI declined to classify this photo.", 422);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ClassifyError("The AI returned no answer.", 502);
  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    throw new ClassifyError("The AI returned an answer in the wrong shape.", 502);
  }
  return { json, raw: response };
}

async function ask(client: Anthropic, model: string, messages: Messages): Promise<{ answer: z.infer<typeof ModelAnswer>; raw: Anthropic.Beta.Messages.BetaMessage }> {
  const { json, raw } = await request(client, model, messages, OUTPUT_SCHEMA, 4000);
  const parsed = ModelAnswer.safeParse(json);
  if (!parsed.success) throw new ClassifyError("The AI returned an answer in the wrong shape.", 502);
  return { answer: parsed.data, raw };
}

function toClassification(answer: z.infer<typeof ModelAnswer>, category: string): Classification {
  return {
    section: answer.section,
    category,
    label: answer.label.slice(0, 120),
    confidence: Math.max(0, Math.min(1, answer.confidence)),
  };
}

export async function classifyPhoto(client: Anthropic, req: ClassifyRequest): Promise<Classification> {
  const [result] = await classifyBatch(client, { photos: [req], categories: req.categories, lessons: req.lessons });
  if ("error" in result) throw new ClassifyError(result.error, 422);
  return result;
}

async function classifyOne(client: Anthropic, model: string, req: ClassifyRequest): Promise<Classification> {
  const messages: Messages = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: req.mediaType, data: req.image } },
        {
          type: "text",
          text: `Existing categories by section:\n${categoryList(req.categories)}\n\n${lessonList(req.lessons)}${hints(req)}\n\nClassify this photo.`,
        },
      ],
    },
  ];

  let { answer, raw } = await ask(client, model, messages);
  let name = pickCategoryName(answer.category, answer.label);

  if (!name) {
    // One corrective retry: append the reply and ask again rather than editing history.
    messages.push({ role: "assistant", content: raw.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    messages.push({
      role: "user",
      content: `"${answer.category}" is a catch-all, which is not allowed. Name the specific kind of item or document in the photo as a new plural category.`,
    });
    ({ answer, raw } = await ask(client, model, messages));
    name = pickCategoryName(answer.category, answer.label);
  }
  if (!name) throw new ClassifyError("Could not find a specific category for this photo.", 422);
  return toClassification(answer, name);
}

export type BatchResult = Classification | { error: string };

/**
 * Classifies several photos in one AI request. The answers come back in the same order. A
 * photo the batch answer misses, or files under a catch-all, gets its own request (with the
 * usual corrective retry), so the no-catch-all rule holds exactly as for a single photo.
 */
export async function classifyBatch(client: Anthropic, req: ClassifyBatchRequest): Promise<BatchResult[]> {
  const first = await classifyWith(client, MODEL, req);
  if (!ESCALATE_MODEL) return first;
  const unsure = req.photos.flatMap((_, i) => {
    const r = first[i];
    return "error" in r || r.confidence < ESCALATE_BELOW ? [i] : [];
  });
  if (!unsure.length) return first;
  const second = await classifyWith(client, ESCALATE_MODEL, { ...req, photos: unsure.map((i) => req.photos[i]) });
  const results = [...first];
  // The second model's answer wins, unless it couldn't place the photo and the first could.
  unsure.forEach((i, j) => {
    if (!("error" in second[j]) || "error" in first[i]) results[i] = second[j];
  });
  return results;
}

async function classifyWith(client: Anthropic, model: string, req: ClassifyBatchRequest): Promise<BatchResult[]> {
  const single = (photo: PhotoInput) =>
    classifyOne(client, model, { ...photo, categories: req.categories, lessons: req.lessons }).catch((err): BatchResult => {
      if (err instanceof ClassifyError) return { error: err.message };
      throw err;
    });
  if (req.photos.length === 1) return [await single(req.photos[0])];

  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
    {
      type: "text",
      text: `Existing categories by section:\n${categoryList(req.categories)}\n\n${lessonList(req.lessons)}Classify each of the ${req.photos.length} photos below on its own. Answer with one entry per photo, using its number.`,
    },
  ];
  req.photos.forEach((photo, i) => {
    const extra = hints(photo);
    content.push({ type: "text", text: `Photo ${i + 1}${extra ? `\n${extra}` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.image } });
  });

  const answers = new Map<number, z.infer<typeof ModelAnswer>>();
  try {
    const { json } = await request(client, model, [{ role: "user", content }], BATCH_SCHEMA, 2000 + 400 * req.photos.length);
    const items = (json as { photos?: unknown })?.photos;
    if (Array.isArray(items)) {
      for (const item of items) {
        const parsed = ModelAnswer.extend({ photo: z.number().int() }).safeParse(item);
        if (parsed.success) answers.set(parsed.data.photo, parsed.data);
      }
    }
  } catch (err) {
    // A refusal or a garbled batch answer: sort each photo on its own instead.
    if (!(err instanceof ClassifyError)) throw err;
  }

  return Promise.all(
    req.photos.map(async (photo, i) => {
      const answer = answers.get(i + 1);
      const name = answer && pickCategoryName(answer.category, answer.label);
      return answer && name ? toClassification(answer, name) : single(photo);
    }),
  );
}
