import { useMemo, useState } from "react";
import { findMatchingCategory, isBannedCategoryName, tidyCategoryName } from "../core/categories";
import { SECTIONS, type Category, type Photo, type Section } from "../core/types";
import { Thumb } from "./Thumb";

export type MoveTarget = { categoryId: string } | { section: Section; name: string };

export function MoveDialog(props: {
  count: number;
  title?: string;
  categories: Category[];
  currentCategoryId?: string;
  defaultSection: Section;
  /** Photos being moved, shown at the top so the person can see what they're sorting. */
  preview?: Photo[];
  /** The AI's best guess, offered as a one-tap answer. */
  suggestion?: { section: Section; category: string };
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

  const guess = props.suggestion && !isBannedCategoryName(props.suggestion.category) ? props.suggestion : undefined;
  const guessMatch = guess ? findMatchingCategory(props.categories, guess.section, guess.category) : undefined;
  const guessName = guessMatch?.name ?? (guess ? tidyCategoryName(guess.category) : "");

  const options = props.categories
    .filter((c) => c.section === section && c.id !== props.currentCategoryId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Move photos" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title ?? `Move ${props.count} photo${props.count === 1 ? "" : "s"}`}</h2>
        {props.preview && props.preview.length > 0 && (
          <ul className={`move-preview ${props.preview.length === 1 ? "single" : ""}`}>
            {props.preview.slice(0, 8).map((p) => (
              <li key={p.id}><Thumb photo={p} alt={p.label ?? p.fileName} /></li>
            ))}
          </ul>
        )}
        {guess && (
          <div className="guess">
            <span className="muted small">OrganizeIt's guess</span>
            <button
              className="chip primary"
              onClick={() => props.onMove(guessMatch ? { categoryId: guessMatch.id } : { section: guess.section, name: guess.category })}
            >
              {guessName}
              <span className="small"> · {SECTIONS.find((s) => s.id === guess.section)!.label}</span>
            </button>
          </div>
        )}
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
