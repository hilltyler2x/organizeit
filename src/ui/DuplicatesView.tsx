import { useMemo, useState } from "react";
import { duplicateTotals, findDuplicates, type DuplicateGroup } from "../core/duplicates";
import { formatBytes } from "../core/storage";
import type { Library } from "../lib/useLibrary";
import { Thumb, forgetImages } from "./Thumb";

// Photos that look like copies of each other. Like To review this is a to-do list, not a
// category: each copy stays in its own category until the person deletes it or says the
// photos aren't duplicates. OrganizeIt suggests keeping the best copy of each set.

export function DuplicatesView({ lib, onDone }: { lib: Library; onDone: () => void }) {
  const groups = useMemo(() => findDuplicates(lib.photos), [lib.photos]);
  const totals = duplicateTotals(groups);
  // Photos the person switched from the suggestion: true = keep, false = delete.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const keeps = (g: DuplicateGroup, id: string) => overrides.get(id) ?? id === g.photos[0].id;
  const toDelete = (g: DuplicateGroup) => g.photos.filter((p) => !keeps(g, p.id));

  const toggle = (g: DuplicateGroup, id: string) => {
    const keep = !keeps(g, id);
    // At least one copy of every set is always kept.
    if (!keep && g.photos.every((p) => p.id === id || !keeps(g, p.id))) return;
    setOverrides((o) => new Map(o).set(id, keep));
  };

  const deletePhotos = async (list: DuplicateGroup["photos"]) => {
    if (!list.length) return;
    const ids = list.map((p) => p.id);
    const bytes = list.reduce((n, p) => n + p.bytes, 0);
    // In the app the phone shows its own delete confirmation.
    if (!lib.native && !confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} (${formatBytes(bytes)}) from OrganizeIt?`)) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const deleted = await lib.remove(ids);
      if (!deleted) return;
      forgetImages(ids);
      setNotice(deleted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const checking = lib.unchecked > 0 && (
    <p className="muted small">Still checking {lib.unchecked.toLocaleString()} photo{lib.unchecked === 1 ? "" : "s"} for duplicates…</p>
  );

  if (groups.length === 0) {
    return (
      <section className="review-view">
        <div className="empty">
          {notice && <p className="banner ok" role="status">{notice}</p>}
          <h1>No duplicates</h1>
          <p className="muted">If you save the same photo twice, OrganizeIt will let you know here.</p>
          {checking}
          <button className="primary" onClick={onDone}>Back to overview</button>
        </div>
      </section>
    );
  }

  const allExtras = groups.flatMap(toDelete);

  return (
    <section className="review-view duplicates-view">
      <header className="category-header">
        <div>
          <p className="eyebrow">Duplicates</p>
          <h1>{totals.extras.toLocaleString()} duplicate photo{totals.extras === 1 ? "" : "s"}</h1>
          <p className="muted">
            These look like copies of each other, using {formatBytes(totals.bytes)}. OrganizeIt keeps the best copy of each set
            (the biggest, then the original). Tap a photo to switch it between Keep and Delete.
          </p>
          {checking}
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}
      {notice && <p className="banner ok" role="status">{notice}</p>}

      <div className="row dupe-actions">
        <button className="danger" disabled={busy || !allExtras.length} onClick={() => deletePhotos(allExtras)}>
          Delete {allExtras.length.toLocaleString()} extra cop{allExtras.length === 1 ? "y" : "ies"} ({formatBytes(allExtras.reduce((n, p) => n + p.bytes, 0))})
        </button>
      </div>

      <ul className="dupe-groups">
        {groups.map((g) => {
          const extras = toDelete(g);
          return (
            <li key={g.photos[0].id} className="dupe-group">
              <ul className="grid">
                {g.photos.map((p) => {
                  const keep = keeps(g, p.id);
                  const category = lib.categories.find((c) => c.id === p.categoryId)?.name;
                  return (
                    <li key={p.id} className={keep ? "keep" : "selected"}>
                      <button
                        className="tile"
                        aria-pressed={!keep}
                        aria-label={`${p.label ?? p.fileName}: ${keep ? "keep" : "delete"}`}
                        onClick={() => toggle(g, p.id)}
                      >
                        <Thumb photo={p} alt={p.label ?? p.fileName} />
                        <span className={`dupe-badge ${keep ? "keep" : "delete"}`}>{keep ? "Keep" : "Delete"}</span>
                        <span className="caption">
                          {p.width}×{p.height} · {formatBytes(p.bytes)}{category ? ` · ${category}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="row">
                <button className="danger" disabled={busy || !extras.length} onClick={() => deletePhotos(extras)}>
                  Delete {extras.length} cop{extras.length === 1 ? "y" : "ies"}
                </button>
                <button disabled={busy} onClick={() => lib.keepAll(g.photos.map((p) => p.id))}>Not duplicates</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
