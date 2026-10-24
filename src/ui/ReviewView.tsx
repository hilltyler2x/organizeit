import { useEffect, useMemo, useState } from "react";
import { categoryMatchKey, tidyCategoryName } from "../core/categories";
import { needsPerson } from "../core/library";
import { formatBytes } from "../core/storage";
import type { Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { MoveDialog } from "./MoveDialog";
import { Thumb, forgetImages } from "./Thumb";

// Photos the AI wasn't sure about (or couldn't sort). This is a to-do list, not a category:
// every photo leaves it by being filed into a real, specific category.

export function ReviewView({ lib, onDone }: { lib: Library; onDone: () => void }) {
  const photos = useMemo(() => needsPerson(lib.photos), [lib.photos]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  // Photos the move dialog is open for: one tapped photo, or the selection.
  const [moving, setMoving] = useState<Photo[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Drop selections for photos that have left the list.
  useEffect(() => {
    const ids = new Set(photos.map((p) => p.id));
    setSelected((s) => (([...s].every((id) => ids.has(id))) ? s : new Set([...s].filter((id) => ids.has(id)))));
  }, [photos]);

  // Shortcut for "these all go to the same place": the AI's guesses, most common first.
  const guesses = useMemo(() => {
    const by = new Map<string, { name: string; ids: string[] }>();
    for (const p of photos) {
      if (!p.suggestion) continue;
      const key = `${p.suggestion.section}:${categoryMatchKey(p.suggestion.category)}`;
      const g = by.get(key) ?? { name: tidyCategoryName(p.suggestion.category), ids: [] };
      g.ids.push(p.id);
      by.set(key, g);
    }
    return [...by.values()].filter((g) => g.ids.length > 1).sort((a, b) => b.ids.length - a.ids.length);
  }, [photos]);

  const chosen = photos.filter((p) => selected.has(p.id));
  const failed = chosen.filter((p) => p.status === "error");
  const allSelected = photos.length > 0 && selected.size === photos.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const deletePhotos = (list: Photo[]) => {
    const ids = list.map((p) => p.id);
    const bytes = list.reduce((n, p) => n + p.bytes, 0);
    // In the app the phone shows its own delete confirmation.
    if (!lib.native && !confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} (${formatBytes(bytes)}) from OrganizeIt?`)) return;
    run(async () => {
      const deleted = await lib.remove(ids);
      if (!deleted) return;
      forgetImages(ids);
      setMoving(null);
      clearSelection();
      setNotice(deleted);
    });
  };

  // One shared guess for the photos being moved, if they all have the same one.
  const sharedGuess = (list: Photo[]) => {
    const first = list[0]?.suggestion;
    if (!first) return undefined;
    const key = categoryMatchKey(first.category);
    return list.every((p) => p.suggestion?.section === first.section && categoryMatchKey(p.suggestion.category) === key) ? first : undefined;
  };

  if (photos.length === 0) {
    return (
      <section className="review-view">
        <div className="empty">
          {notice && <p className="banner ok" role="status">{notice}</p>}
          <h1>All caught up</h1>
          <p className="muted">Every photo is in a category. If OrganizeIt isn't sure about a new one, it will show up here.</p>
          <button className="primary" onClick={onDone}>Back to overview</button>
        </div>
      </section>
    );
  }

  return (
    <section className="review-view">
      <header className="category-header">
        <div>
          <p className="eyebrow">To review</p>
          <h1>Help sort {photos.length} photo{photos.length === 1 ? "" : "s"}</h1>
          <p className="muted">
            OrganizeIt wasn't sure where these go. Tap a photo to choose its category or delete it, or tap Select to send
            several to the same place or delete them together. Each answer teaches OrganizeIt{lib.lessonCount ? ` (it has learned from ${lib.lessonCount} so far)` : ""}.
          </p>
        </div>
        <button onClick={() => (selecting ? clearSelection() : setSelecting(true))}>{selecting ? "Done" : "Select"}</button>
      </header>

      {error && <p className="error banner">{error}</p>}
      {notice && <p className="banner ok" role="status">{notice}</p>}

      {guesses.length > 0 && (
        <div className="guess-groups">
          <span className="muted small">Select all guessed as</span>
          {guesses.map((g) => (
            <button
              key={g.name}
              className="chip"
              onClick={() => {
                setSelecting(true);
                setSelected(new Set(g.ids));
              }}
            >
              {g.name} <span className="muted">{g.ids.length}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="grid">
        {photos.map((p) => (
          <li key={p.id} className={selected.has(p.id) ? "selected" : ""}>
            <button
              className="tile"
              aria-pressed={selecting ? selected.has(p.id) : undefined}
              aria-label={p.label ?? p.fileName}
              title={p.error}
              onClick={() => (selecting ? toggle(p.id) : setMoving([p]))}
            >
              <Thumb photo={p} alt={p.label ?? p.fileName} />
              {selecting && <span className="check" aria-hidden>{selected.has(p.id) ? "✓" : ""}</span>}
              <span className="caption">
                {p.status === "error" ? "Couldn't sort" : p.suggestion ? `${tidyCategoryName(p.suggestion.category)}?` : p.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selecting && (
        <div className="bulk-bar">
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)))}>
            {allSelected ? "Select none" : "Select all"}
          </button>
          <span className="muted">{selected.size} selected</span>
          <span className="spacer" />
          {failed.length > 0 && (
            <button onClick={() => run(async () => { await lib.retry(failed.map((p) => p.id)); setSelected(new Set()); })}>Retry</button>
          )}
          <button className="primary" disabled={!selected.size} onClick={() => setMoving(chosen)}>Move</button>
          <button className="danger" disabled={!selected.size} onClick={() => deletePhotos(chosen)}>Delete</button>
        </div>
      )}

      {moving && (
        <MoveDialog
          count={moving.length}
          title={moving.length === 1 ? "Where does this go?" : `Where do these ${moving.length} go?`}
          categories={lib.categories}
          preview={moving}
          suggestion={sharedGuess(moving)}
          defaultSection={sharedGuess(moving)?.section ?? moving[0]?.suggestion?.section ?? "products"}
          onClose={() => setMoving(null)}
          onDelete={() => deletePhotos(moving)}
          onMove={(target) =>
            run(async () => {
              await lib.move(moving.map((p) => p.id), target);
              setMoving(null);
              clearSelection();
            })
          }
        />
      )}
    </section>
  );
}
