import { useMemo, useState } from "react";
import { findMatchingCategory, isBannedCategoryName, tidyCategoryName } from "../core/categories";
import { SECTIONS, type Category, type Section } from "../core/types";

export type MoveTarget = { categoryId: string } | { section: Section; name: string };

export function MoveDialog(props: {
  count: number;
  categories: Category[];
  currentCategoryId?: string;
  defaultSection: Section;
  onMove: (target: MoveTarget) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>(props.defaultSection);
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const banned = trimmed !== "" && isBannedCategoryName(trimmed);
  const match = useMemo(
    () => (trimmed && !banned ? findMatchingCategory(props.categories, section, trimmed) : undefined),
    [trimmed, banned, props.categories, section],
  );

  const options = props.categories
    .filter((c) => c.section === section && c.id !== props.currentCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Move photos" onClick={(e) => e.stopPropagation()}>
        <h2>Move {props.count} photo{props.count === 1 ? "" : "s"}</h2>
        <div className="segmented" role="tablist">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? "on" : ""} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="chip-list">
          {options.map((c) => (
            <button key={c.id} className="chip" onClick={() => props.onMove({ categoryId: c.id })}>
              {c.name}
            </button>
          ))}
          {options.length === 0 && <p className="muted">No categories here yet. Name one below.</p>}
        </div>
        <form
          className="new-category"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed || banned) return;
            props.onMove(match ? { categoryId: match.id } : { section, name: trimmed });
          }}
        >
          <label htmlFor="new-cat">Or a new category</label>
          <div className="row">
            <input id="new-cat" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunglasses" autoComplete="off" />
            <button className="primary" type="submit" disabled={!trimmed || banned}>
              {match ? `Move to ${match.name}` : "Create & move"}
            </button>
          </div>
          {banned && <p className="error">Catch-all names aren't allowed. Name the specific kind of item, like "{tidyCategoryName("phone cases")}".</p>}
        </form>
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
