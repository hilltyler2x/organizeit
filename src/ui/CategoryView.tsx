import { useEffect, useMemo, useState } from "react";
import { isBannedCategoryName } from "../core/categories";
import { formatBytes } from "../core/storage";
import { SECTIONS, type Category, type Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { MoveDialog } from "./MoveDialog";
import { PhotoViewer } from "./PhotoViewer";
import { Thumb, forgetImages } from "./Thumb";

export function CategoryView({ lib, category, onGone }: { lib: Library; category: Category; onGone: () => void }) {
  const photos = useMemo(
    () => lib.photos.filter((p) => p.categoryId === category.id && p.status === "sorted").sort((a, b) => b.takenAt - a.takenAt),
    [lib.photos, category.id],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(category.name);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
    setRenaming(false);
    setNewName(category.name);
    setError("");
  }, [category.id, category.name]);

  const bytes = photos.reduce((n, p) => n + p.bytes, 0);
  const selectedBytes = photos.filter((p) => selected.has(p.id)).reduce((n, p) => n + p.bytes, 0);
  const allSelected = photos.length > 0 && selected.size === photos.length;
  const section = SECTIONS.find((s) => s.id === category.section)!;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteSelected = () => {
    const ids = [...selected];
    // In the app the phone shows its own delete confirmation.
    if (!lib.native && !confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} (${formatBytes(selectedBytes)}) from OrganizeIt?`)) return;
    run(async () => {
      const lastOnes = ids.length === photos.length && !category.seeded;
      if (!(await lib.remove(ids))) return;
      forgetImages(ids);
      setSelected(new Set());
      setSelecting(false);
      if (lastOnes) onGone();
    });
  };

  return (
    <section className="category-view">
      <header className="category-header">
        <div>
          <p className="eyebrow">{section.label}</p>
          {renaming ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await lib.rename(category.id, newName);
                  setRenaming(false);
                });
              }}
            >
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label="Category name" />
              <button className="primary" type="submit" disabled={!newName.trim() || isBannedCategoryName(newName)}>Save</button>
              <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
            </form>
          ) : (
            <h1>
              {category.name}
              <button className="link" onClick={() => setRenaming(true)}>Rename</button>
            </h1>
          )}
          <p className="muted">
            {photos.length} photo{photos.length === 1 ? "" : "s"} · {formatBytes(bytes)}
          </p>
        </div>
        {photos.length > 0 && (
          <button
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? "Done" : "Select"}
          </button>
        )}
      </header>

      {error && <p className="error banner">{error}</p>}

      {photos.length === 0 ? (
        <div className="empty">
          <p>No photos in {category.name} yet.</p>
          <p className="muted">Add photos and OrganizeIt files matching ones here automatically.</p>
        </div>
      ) : (
        <ul className="grid">
          {photos.map((p) => (
            <li key={p.id} className={selected.has(p.id) ? "selected" : ""}>
              <button
                className="tile"
                aria-pressed={selecting ? selected.has(p.id) : undefined}
                aria-label={p.label ?? p.fileName}
                onClick={() => (selecting ? toggle(p.id) : setViewing(p))}
              >
                <Thumb photo={p} alt={p.label ?? p.fileName} />
                {selecting && <span className="check" aria-hidden>{selected.has(p.id) ? "✓" : ""}</span>}
                {p.label && <span className="caption">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selecting && (
        <div className="bulk-bar">
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)))}>
            {allSelected ? "Select none" : "Select all"}
          </button>
          <span className="muted">
            {selected.size} selected{selected.size ? ` · ${formatBytes(selectedBytes)}` : ""}
          </span>
          <span className="spacer" />
          <button disabled={!selected.size} onClick={() => setMoving(true)}>Move</button>
          <button className="danger" disabled={!selected.size} onClick={deleteSelected}>Delete</button>
        </div>
      )}

      {moving && (
        <MoveDialog
          count={selected.size}
          categories={lib.categories}
          currentCategoryId={category.id}
          defaultSection={category.section}
          onClose={() => setMoving(false)}
          onMove={(target) =>
            run(async () => {
              const lastOnes = selected.size === photos.length && !category.seeded;
              await lib.move([...selected], target);
              setMoving(false);
              setSelected(new Set());
              setSelecting(false);
              if (lastOnes) onGone();
            })
          }
        />
      )}

      {viewing && (
        <PhotoViewer
          lib={lib}
          photo={viewing}
          category={category}
          onClose={() => setViewing(null)}
          onEmptied={() => {
            setViewing(null);
            if (photos.length === 1 && !category.seeded) onGone();
          }}
        />
      )}
    </section>
  );
}
