import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findMatchingCategory, isBannedCategoryName, tidyCategoryName } from "../core/categories";
import { SECTIONS, type Category, type Photo, type Section } from "../core/types";
import { BackLayer, useBack } from "./back";
import { PhotoZoom } from "./PhotoZoom";
import { Thumb } from "./Thumb";
import { VideoPlayer } from "./VideoPlayer";

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
  /** Offered next to the guess, for photos the person would rather get rid of than file. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  useBack(true, props.onClose, BackLayer.dialog);
  const [section, setSection] = useState<Section>(props.defaultSection);
  const [name, setName] = useState("");
  const [zoomAt, setZoomAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Always open at the top so the question is the first thing seen, even if a video loading in nudges the scroll.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTop = 0;
    const id = requestAnimationFrame(() => (el.scrollTop = 0));
    return () => cancelAnimationFrame(id);
  }, []);
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

  // Drawn on top of the whole app, so the top bar never covers the title.
  return createPortal(
    <div className="modal-backdrop" onClick={props.onClose}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label="Move photos" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{props.title ?? `Move ${props.count} photo${props.count === 1 ? "" : "s"}`}</h2>
        {props.preview?.length === 1 && props.preview[0].isVideo ? (
          // One video: it plays right away, so the person can see what's in it before choosing.
          <div className="move-video">
            <VideoPlayer photo={props.preview[0]} />
          </div>
        ) : props.preview && props.preview.length > 0 && (
          <ul className={`move-preview ${props.preview.length === 1 ? "single" : ""}`}>
            {props.preview.slice(0, 8).map((p, i) => (
              <li key={p.id}>
                <button className="preview-open" aria-label={`Look closer at ${p.label ?? p.fileName}`} onClick={() => setZoomAt(i)}>
                  <Thumb photo={p} alt={p.label ?? p.fileName} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.preview && props.preview.length > 0 && !(props.preview.length === 1 && props.preview[0].isVideo) && (
          <p className="muted small zoom-hint">Tap the {props.preview.length === 1 ? "photo" : "photos"} to look closer.</p>
        )}
        {zoomAt !== null && props.preview && <PhotoZoom photos={props.preview.slice(0, 8)} start={zoomAt} onClose={() => setZoomAt(null)} />}
        {(guess || props.onDelete) && (
          <div className="guess">
            {guess && (
              <>
                <span className="muted small">OrganizeIt's guess</span>
                <button
                  className="chip primary"
                  onClick={() => props.onMove(guessMatch ? { categoryId: guessMatch.id } : { section: guess.section, name: guess.category })}
                >
                  {guessName}
                  <span className="small"> · {SECTIONS.find((s) => s.id === guess.section)!.label}</span>
                </button>
              </>
            )}
            {props.onDelete && (
              <button className="chip danger" onClick={props.onDelete}>
                {props.count === 1 ? (props.preview?.[0]?.isVideo ? "Delete video" : "Delete photo") : `Delete ${props.count} photos`}
              </button>
            )}
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
    </div>,
    document.body,
  );
}
