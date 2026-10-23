import { categoryMatchKey } from "./categories";
import type { LibraryState } from "./library";
import type { Category, Lesson, Section } from "./types";

// The app learns from the person's corrections: each time they file a photo the AI was unsure
// about, or move one the AI filed, the AI's description of it and the right category are kept
// and sent with later sorts as examples.

/** How many corrections are kept on the device, newest first. */
export const MAX_LESSONS = 300;
/** How many are sent with each sort, to keep requests small. */
export const LESSONS_PER_REQUEST = 60;

/**
 * Lessons from a move: every moved photo that has a description and ended up somewhere other
 * than where the AI put (or wanted to put) it. `before` is the library before the move.
 */
export function lessonsFromMove(before: LibraryState, after: LibraryState, photoIds: string[], newId: () => string, now: number = Date.now()): Lesson[] {
  const ids = new Set(photoIds);
  const name = (id?: string) => before.categories.find((c) => c.id === id)?.name;
  const out: Lesson[] = [];
  for (const prev of before.photos) {
    if (!ids.has(prev.id) || !prev.label) continue;
    const next = after.photos.find((p) => p.id === prev.id);
    if (!next?.categoryId || next.status !== "sorted") continue;
    const target = after.categories.find((c) => c.id === next.categoryId);
    if (!target) continue;
    const wrongCategory = prev.status === "review" ? prev.suggestion?.category : name(prev.categoryId);
    // Confirming the AI's own guess still teaches it (it was unsure); a move within the same
    // category does not.
    if (prev.status === "sorted" && prev.categoryId === next.categoryId) continue;
    const confirmed = wrongCategory !== undefined && categoryMatchKey(wrongCategory) === categoryMatchKey(target.name);
    out.push({ id: newId(), label: prev.label, categoryId: target.id, section: target.section, category: target.name, wrongCategory: confirmed ? undefined : wrongCategory, createdAt: now });
  }
  return out;
}

/**
 * Adds new lessons, replacing older ones about the same kind of thing (same description), and
 * trims to MAX_LESSONS. Returns the full list to keep and the ids that were dropped.
 */
export function addLessons(existing: Lesson[], added: Lesson[]): { lessons: Lesson[]; dropped: string[] } {
  const key = (l: Lesson) => l.label.trim().toLowerCase();
  const newKeys = new Set(added.map(key));
  const merged = [...added, ...existing.filter((l) => !newKeys.has(key(l)))]
    .sort((a, b) => b.createdAt - a.createdAt);
  // Duplicate labels within `added` itself: keep the first.
  const seen = new Set<string>();
  const unique = merged.filter((l) => (seen.has(key(l)) ? false : (seen.add(key(l)), true)));
  const lessons = unique.slice(0, MAX_LESSONS);
  const kept = new Set(lessons.map((l) => l.id));
  return { lessons, dropped: existing.filter((l) => !kept.has(l.id)).map((l) => l.id) };
}

export interface LessonForPrompt {
  label: string;
  section: Section;
  category: string;
  wrong?: string;
}

/**
 * The newest lessons, with category ids turned into current names (so renames carry over).
 * If a lesson's category has since been removed, the name it had is used.
 */
export function lessonsForPrompt(lessons: Lesson[], categories: Category[], limit = LESSONS_PER_REQUEST): LessonForPrompt[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: LessonForPrompt[] = [];
  for (const l of [...lessons].sort((a, b) => b.createdAt - a.createdAt)) {
    const c = byId.get(l.categoryId) ?? { section: l.section, name: l.category };
    const wrong = l.wrongCategory && categoryMatchKey(l.wrongCategory) !== categoryMatchKey(c.name) ? l.wrongCategory : undefined;
    out.push({ label: l.label.slice(0, 120), section: c.section, category: c.name, ...(wrong ? { wrong: wrong.slice(0, 80) } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}
