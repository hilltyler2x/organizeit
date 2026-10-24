import { useEffect, useMemo, useRef, useState } from "react";
import { isBannedCategoryName } from "../core/categories";
import { formatBytes } from "../core/storage";
import { SECTIONS, type Category, type Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { AlbumDialog } from "./AlbumDialog";
import { MoveDialog } from "./MoveDialog";
import { PhotoViewer } from "./PhotoViewer";
import { useLongPress, useScrolledPast } from "./selection";
import { Thumb, forgetImages } from "./Thumb";

export function CategoryView({ lib, category, onGone }: { lib: Library; category: Category; onGone: () => void }) {
  const photos = useMemo(
    () => lib.photos.filter((p) => p.categoryId === category.id && p.status === "sorted").sort((a, b) => b.takenAt - a.takenAt),
    [lib.photos, category.id],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [albuming, setAlbuming] = useState(false);
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(category.name);
  const [error, setError] = useState("");
  const header = useRef<HTMLElement>(null);
  const headerGone = useScrolledPast(header);
  const press = useLongPress((id) => {
    setSelecting(true);
    setSelected((s) => new Set(s).add(id));
  });

  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
    setRenaming(false);
    setNewName(category.name);
    setError("");
    setNotice("");
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
    setNotice("");
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
      const deleted = await lib.remove(ids);
      if (!deleted) return;
      forgetImages(ids);
      setSelected(new Set());
      setSelecting(false);
      setNotice(deleted);
      if (lastOnes) onGone();
    });
  };

  return (
    <section className="category-view">
      <header className="category-header" ref={header}>
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
      {notice && <p className="banner ok" role="status">{notice}</p>}

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
                {...press.handlers(p.id)}
                onClick={() => {
                  if (press.consumed()) return;
                  selecting ? toggle(p.id) : setViewing(p);
                }}
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
          {lib.canMakeAlbums && (
            <button disabled={!selected.size} onClick={() => setAlbuming(true)}>Album</button>
          )}
          <button disabled={!selected.size} onClick={() => setMoving(true)}>Move</button>
          <button className="danger" disabled={!selected.size} onClick={deleteSelected}>Delete</button>
          <button onClick={() => { setSelecting(false); setSelected(new Set()); }}>Done</button>
        </div>
      )}

      {!selecting && headerGone && photos.length > 0 && (
        <button className="floating-select" onClick={() => setSelecting(true)}>Select</button>
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

      {albuming && (
        <AlbumDialog
          count={selected.size}
          categoryName={category.name}
          onClose={() => setAlbuming(false)}
          onSave={(title) =>
            run(async () => {
              const { added, created } = await lib.addToAlbum([...selected], title);
              setAlbuming(false);
              setSelected(new Set());
              setSelecting(false);
              setNotice(`Added ${added} photo${added === 1 ? "" : "s"} to ${created ? "new album " : ""}"${title}" in Photos.`);
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
          onEmptied={(deleted) => {
            setViewing(null);
            if (deleted) setNotice(deleted);
            if (photos.length === 1 && !category.seeded) onGone();
          }}
        />
      )}
    </section>
  );
}
