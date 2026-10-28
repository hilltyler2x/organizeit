import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatDuration } from "../core/storage";
import type { Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { useImageUrl } from "./Thumb";
import { VideoPlayer } from "./VideoPlayer";

// Full-screen look at one set of duplicates, to check they really are copies before deleting.
// Pinch or double-tap to zoom, drag to look around a zoomed photo, and swipe (or use the arrow
// keys) to go between the copies. Each copy's size, date and time are shown, with Close and
// Delete buttons always at the bottom. Drawn over the whole app (not inside the page), so the
// app's top bar can't cover it.

const MAX_ZOOM = 6;
const SWIPE_PX = 60;

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

export function DuplicateInspector(props: {
  lib: Library;
  photos: Photo[];
  start: number;
  keeps: (id: string) => boolean;
  onDelete: (photo: Photo) => void;
  busy: boolean;
  onClose: () => void;
}) {
  const { photos } = props;
  const [index, setIndex] = useState(Math.min(props.start, photos.length - 1));
  const photo = photos[Math.min(index, photos.length - 1)];
  const [view, setView] = useState<View>(FIT);
  // Fingers (or the mouse) on the photo, and where the current gesture began.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; x: number; y: number; dist: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const go = (step: number) => setIndex((i) => Math.max(0, Math.min(photos.length - 1, i + step)));

  useEffect(() => setView(FIT), [photo?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!photo) return null;

  const center = () => {
    const pts = [...pointers.current.values()];
    const x = pts.reduce((n, p) => n + p.x, 0) / pts.length;
    const y = pts.reduce((n, p) => n + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { x, y, dist };
  };

  const begin = () => {
    const c = center();
    gesture.current = { view, ...c, moved: gesture.current?.moved ?? false };
  };

  const onDown = (e: PointerEvent) => {
    // A video needs its own taps (to show its controls), so the stage doesn't capture them.
    if (!photo.isVideo) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = null;
    begin();
  };

  const onMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const c = center();
    if (Math.hypot(c.x - g.x, c.y - g.y) > 6 || (c.dist && Math.abs(c.dist - g.dist) > 6)) g.moved = true;
    if (photo.isVideo) return; // videos aren't zoomed; a swipe still goes to the next copy
    if (pointers.current.size > 1 && g.dist) {
      const scale = Math.max(1, Math.min(MAX_ZOOM, (g.view.scale * c.dist) / g.dist));
      setView(scale === 1 ? FIT : { scale, x: g.view.x + (c.x - g.x), y: g.view.y + (c.y - g.y) });
    } else if (g.view.scale > 1) {
      setView({ ...g.view, x: g.view.x + (c.x - g.x), y: g.view.y + (c.y - g.y) });
    }
  };

  const onUp = (e: PointerEvent) => {
    const g = gesture.current;
    const point = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      begin(); // one finger lifted from a pinch: carry on panning from here
      return;
    }
    gesture.current = null;
    if (!g || !point) return;
    // Not zoomed in: a sideways swipe goes to the next or previous copy.
    if (g.view.scale === 1 && view.scale === 1) {
      const dx = point.x - g.x;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(point.y - g.y)) {
        go(dx < 0 ? 1 : -1);
        return;
      }
    }
    if (g.moved || photo.isVideo) return;
    // Double tap: zoom in on that spot, or back out.
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      zoomAt(point.x, point.y, view.scale > 1 ? 1 : 2.5, e.currentTarget as HTMLElement);
    } else {
      lastTap.current = now;
    }
  };

  const zoomAt = (clientX: number, clientY: number, scale: number, stage: HTMLElement) => {
    if (scale <= 1) return setView(FIT);
    const r = stage.getBoundingClientRect();
    const px = clientX - (r.left + r.width / 2);
    const py = clientY - (r.top + r.height / 2);
    // Keep the spot under the finger where it is.
    setView((v) => ({ scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale }));
  };

  const onWheel = (e: WheelEvent) => {
    const scale = Math.max(1, Math.min(MAX_ZOOM, view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    zoomAt(e.clientX, e.clientY, scale, e.currentTarget as HTMLElement);
  };

  const keep = props.keeps(photo.id);
  const category = props.lib.categories.find((c) => c.id === photo.categoryId)?.name;
  const taken = new Date(photo.takenAt);

  return createPortal(
    <div className="inspector" role="dialog" aria-modal="true" aria-label={`Copy ${index + 1} of ${photos.length}`}>
      <div className="inspector-top">
        <span className="inspector-count">Copy {index + 1} of {photos.length}</span>
        <span className={`inspector-tag ${keep ? "keep" : "delete"}`}>{keep ? "Keeping" : "Set to delete"}</span>
      </div>

      <div
        className="inspector-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <InspectorImage photo={photo} view={view} />
        {index > 0 && <button className="inspector-nav prev" aria-label="Previous copy" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)}>‹</button>}
        {index < photos.length - 1 && <button className="inspector-nav next" aria-label="Next copy" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}>›</button>}
      </div>

      <div className="inspector-info">
        <div className="inspector-dots" aria-hidden>
          {photos.map((p, i) => (
            <span key={p.id} className={`${i === index ? "on" : ""} ${props.keeps(p.id) ? "keep" : "delete"}`} />
          ))}
        </div>
        <dl>
          <dt>Taken</dt>
          <dd>{taken.toLocaleDateString()} {taken.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</dd>
          <dt>Size</dt>
          <dd>{photo.width}×{photo.height} · {formatBytes(photo.bytes)}</dd>
          {photo.isVideo && photo.durationMs ? (<><dt>Length</dt><dd>{formatDuration(photo.durationMs)}</dd></>) : null}
          {category && (<><dt>Category</dt><dd>{category}</dd></>)}
          <dt>File</dt>
          <dd>{photo.fileName}</dd>
        </dl>
        <p className="muted small">{photo.isVideo ? "Tap the video for pause and sound." : "Pinch or double-tap to zoom."} Swipe to see the other copies.</p>
        <div className="inspector-actions">
          <button className="big" onClick={props.onClose}>Close</button>
          <button className="danger big" disabled={props.busy} onClick={() => props.onDelete(photo)}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InspectorImage({ photo, view }: { photo: Photo; view: View }) {
  if (photo.isVideo) return <VideoPlayer key={photo.id} photo={photo} />;
  return <InspectorStill photo={photo} view={view} />;
}

function InspectorStill({ photo, view }: { photo: Photo; view: View }) {
  const thumb = useImageUrl(photo, "thumb");
  const full = useImageUrl(photo, "full");
  const src = full ?? thumb;
  if (!src) return <div className="inspector-wait">Loading…</div>;
  return (
    <img
      src={src}
      alt={photo.label ?? photo.fileName}
      draggable={false}
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
    />
  );
}
