import { categoryMatchKey, findMatchingCategory, isBannedCategoryName } from "./categories";
import type { LibraryState } from "./library";
import type { Category, Classification, Lesson, Photo } from "./types";

// The person's sorting habits, applied on the phone with no extra AI cost. The AI already sees
// a sample of their corrections (core/lessons.ts); these rules make sure the answer it gives is
// then filed the way this person files things:
// - a photo described like one they filed by hand goes where they put that one,
// - a category they renamed keeps catching photos the AI calls by the old name,
// - a category they keep emptying into another one isn't filled again by the AI,
// - and when they move a photo, look-alikes the AI put in the same wrong place move with it.

const FILLER = new Set(["a", "an", "the", "of", "with", "and", "in", "on", "for", "to", "photo", "picture", "image", "pic"]);

function labelWords(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .replace(/['’]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !FILLER.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/**
 * Two descriptions of the same kind of thing: "Nike Dunk Low Panda sneaker" and "Nike Dunk
 * Low sneakers" are; "Walmart receipt" and "Target receipt", or "black hoodie" and "grey
 * hoodie", are not.
 */
export function labelsAlike(a: string, b: string): boolean {
  const x = labelWords(a);
  const y = labelWords(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  if (shared === x.size && shared === y.size) return true;
  return shared >= 2 && shared / (x.size + y.size - shared) >= 0.75;
}

/** The category a lesson points at now (renames carry over), or its old name if it's gone. */
function lessonTarget(l: Lesson, categories: Category[]): { section: Category["section"]; name: string } {
  return categories.find((c) => c.id === l.categoryId) ?? { section: l.section, name: l.category };
}

/** Corrections out of a category must agree this much before the AI's use of it is redirected. */
const REDIRECT_AGREEMENT = 0.8;
const REDIRECT_MIN = 2;

/**
 * Adjusts the AI's answer to the person's habits. Only the section and category change; the
 * description and confidence stay the AI's. Never returns a catch-all.
 */
export function followHabits(result: Classification, lessons: Lesson[], state: LibraryState): Classification {
  const to = (target: { section: Category["section"]; name: string }): Classification =>
    isBannedCategoryName(target.name) ? result : { ...result, section: target.section, category: target.name };

  // 1. Filed one like this by hand before: put it in the same place (the newest such choice).
  const alike = [...lessons].sort((a, b) => b.createdAt - a.createdAt).find((l) => labelsAlike(l.label, result.label));
  if (alike) return to(lessonTarget(alike, state.categories));

  const existing = findMatchingCategory(state.categories, result.section, result.category);

  // 2. The AI used a name the person renamed away from: file under the new name.
  if (!existing) {
    const renamed = state.categories.find(
      (c) => c.section === result.section && c.aliases?.some((a) => findMatchingCategory([{ section: c.section, name: a }], c.section, result.category)),
    );
    if (renamed) return to(renamed);
  }

  // 3. A category the person has emptied by moving its photos elsewhere, always to the same
  // place: the AI's photos for it go there too. A category that still holds photos is left
  // alone, since moving a few mistakes out of it doesn't make it wrong for everything.
  if (existing && state.photos.some((p) => p.status === "sorted" && p.categoryId === existing.id)) return result;
  const key = categoryMatchKey(result.category);
  const out = lessons.filter((l) => l.wrongCategory && categoryMatchKey(l.wrongCategory) === key);
  if (out.length < REDIRECT_MIN) return result;
  const counts = new Map<string, number>();
  for (const l of out) counts.set(l.categoryId, (counts.get(l.categoryId) ?? 0) + 1);
  const [topId, top] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top / out.length < REDIRECT_AGREEMENT) return result;
  const target = lessonTarget(out.find((l) => l.categoryId === topId)!, state.categories);
  return categoryMatchKey(target.name) === key ? result : to(target);
}

/**
 * After the person moves photos, other photos that look like the same kind of thing and sit
 * where the AI wrongly put the moved ones: AI-filed photos in the category they were moved
 * out of, and photos waiting in To review. Photos the person filed themselves are never
 * touched. `before` and `after` are the library either side of the move.
 */
export function alsoMove(before: LibraryState, after: LibraryState, movedIds: string[]): string[] {
  const moved = new Set(movedIds);
  const nowIn = new Map(after.photos.map((p) => [p.id, p.categoryId]));
  const corrections: { label: string; from?: string; to: string }[] = [];
  for (const p of before.photos) {
    const to = nowIn.get(p.id);
    if (!moved.has(p.id) || !p.label || !to) continue;
    if (p.status === "review") corrections.push({ label: p.label, to });
    else if (p.status === "sorted" && p.categoryId && p.categoryId !== to) corrections.push({ label: p.label, from: p.categoryId, to });
  }
  if (!corrections.length) return [];
  const waiting = (p: Photo, c: (typeof corrections)[number]) =>
    p.status === "review" || (c.from !== undefined && p.status === "sorted" && p.filedAt !== undefined && p.categoryId === c.from);
  return after.photos
    .filter((p) => !moved.has(p.id) && p.label && corrections.some((c) => waiting(p, c) && p.categoryId !== c.to && labelsAlike(p.label!, c.label)))
    .map((p) => p.id);
}

/** Adds an old name to a category's aliases, dropping any that now mean its own name. */
export function withAlias(category: Category, oldName: string): Category {
  const own = categoryMatchKey(category.name);
  const aliases = [...(category.aliases ?? []), oldName].filter(
    (a, i, all) => categoryMatchKey(a) !== own && all.findIndex((b) => categoryMatchKey(b) === categoryMatchKey(a)) === i,
  );
  return { ...category, aliases };
}
