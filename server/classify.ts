import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isBannedCategoryName, pickCategoryName } from "../src/core/categories";
import type { Classification, Section } from "../src/core/types";

export const MODEL = "claude-opus-5-5";

export const ClassifyRequest = z.object({
  image: z.string().min(1), // base64, no data: prefix
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  fileName: z.string().max(300).default(""),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  isScreenshot: z.boolean().default(false),
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
export type ClassifyRequest = z.infer<typeof ClassifyRequest>;

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

The label is a few words describing the specific thing shown.

Confidence is between 0 and 1 and decides whether the person is asked to check your answer. Give below 0.6 when you can't really tell: the item is blurry, cut off or hidden, it could belong to two categories, or it isn't clear whether a screenshot is a business expense. Even then, give your best specific guess.

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

function hints(req: ClassifyRequest): string {
  const parts: string[] = [];
  if (req.fileName) parts.push(`File name: ${req.fileName}`);
  if (req.width && req.height) parts.push(`Original size: ${req.width}x${req.height}`);
  if (req.isScreenshot) parts.push("The phone marked this photo as a screenshot.");
  return parts.join("\n");
}

export class ClassifyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

type Messages = Anthropic.Beta.Messages.BetaMessageParam[];

async function ask(client: Anthropic, messages: Messages): Promise<{ answer: z.infer<typeof ModelAnswer>; raw: Anthropic.Beta.Messages.BetaMessage }> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages,
  });
  if (response.stop_reason === "refusal") throw new ClassifyError("The AI declined to classify this photo.", 422);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ClassifyError("The AI returned no answer.", 502);
  const parsed = ModelAnswer.safeParse(JSON.parse(text.text));
  if (!parsed.success) throw new ClassifyError("The AI returned an answer in the wrong shape.", 502);
  return { answer: parsed.data, raw: response };
}

export async function classifyPhoto(client: Anthropic, req: ClassifyRequest): Promise<Classification> {
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

  let { answer, raw } = await ask(client, messages);
  let name = pickCategoryName(answer.category, answer.label);

  if (!name) {
    // One corrective retry: append the reply and ask again rather than editing history.
    messages.push({ role: "assistant", content: raw.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    messages.push({
      role: "user",
      content: `"${answer.category}" is a catch-all, which is not allowed. Name the specific kind of item or document in the photo as a new plural category.`,
    });
    ({ answer, raw } = await ask(client, messages));
    name = pickCategoryName(answer.category, answer.label);
  }
  if (!name) throw new ClassifyError("Could not find a specific category for this photo.", 422);

  return {
    section: answer.section,
    category: name,
    label: answer.label.slice(0, 120),
    confidence: Math.max(0, Math.min(1, answer.confidence)),
  };
}
