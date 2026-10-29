import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatDuration } from "../core/storage";
import type { Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { BackLayer, useBack } from "./back";
import { useImageUrl } from "./Thumb";
import { VideoPlayer } from "./VideoPlayer";
import { usePinchZoom } from "./zoom";

// Full-screen look at one set of duplicates, to check they really are copies before deleting.
// Pinch or double-tap to zoom, drag to look around a zoomed photo, and swipe (or use the arrow
// keys) to go between the copies. Each copy's size, date and time are shown, with Close and
// Delete buttons always at the bottom. Drawn over the whole app (not inside the page), so the
// app's top bar can't cover it.

export function DuplicateInspector(props: {
  lib: Library;
  photos: Photo[];
  start: number;
  keeps: (id: string) => boolean;
  onDelete: (photo: Photo) => void;
  busy: boolean;
  onClose: () => void;
}) {
  useBack(true, props.onClose, BackLayer.menu);
  const { photos } = props;
  const [index, setIndex] = useState(Math.min(props.start, photos.length - 1));
  const photo = photos[Math.min(index, photos.length - 1)];
  const go = (step: number) => setIndex((i) => Math.max(0, Math.min(photos.length - 1, i + step)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const zoom = usePinchZoom({ resetKey: photo?.id ?? "", enabled: !photo?.isVideo, onSwipe: go });

  if (!photo) return null;

  const keep = props.keeps(photo.id);
  const category = props.lib.categories.find((c) => c.id === photo.categoryId)?.name;
  const taken = new Date(photo.takenAt);

  return createPortal(
    <div className="inspector" role="dialog" aria-modal="true" aria-label={`Copy ${index + 1} of ${photos.length}`}>
      <div className="inspector-top">
        <span className="inspector-count">Copy {index + 1} of {photos.length}</span>
        <span className={`inspector-tag ${keep ? "keep" : "delete"}`}>{keep ? "Keeping" : "Set to delete"}</span>
      </div>

      <div className="inspector-stage" {...zoom.handlers}>
        <InspectorImage photo={photo} style={zoom.style} />
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

function InspectorImage({ photo, style }: { photo: Photo; style: CSSProperties }) {
  if (photo.isVideo) return <VideoPlayer key={photo.id} photo={photo} />;
  return <InspectorStill photo={photo} style={style} />;
}

function InspectorStill({ photo, style }: { photo: Photo; style: CSSProperties }) {
  const thumb = useImageUrl(photo, "thumb");
  const full = useImageUrl(photo, "full");
  const src = full ?? thumb;
  if (!src) return <div className="inspector-wait">Loading…</div>;
  return (
    <img
      src={src}
      alt={photo.label ?? photo.fileName}
      draggable={false}
      style={style}
    />
  );
}
