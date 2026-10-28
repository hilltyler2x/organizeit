import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Photo } from "../core/types";
import { useImageUrl } from "./Thumb";
import { VideoPlayer } from "./VideoPlayer";
import { usePinchZoom } from "./zoom";

// Full-screen look at the photos being sorted, opened by tapping one in the "Where does this
// go?" box. Pinch or double-tap to zoom, drag to look around, swipe between them. Drawn over the
// whole app, like the duplicates inspector, so the top bar can't cover it.

export function PhotoZoom(props: { photos: Photo[]; start: number; onClose: () => void }) {
  const { photos } = props;
  const [index, setIndex] = useState(Math.min(props.start, photos.length - 1));
  const photo = photos[Math.min(index, photos.length - 1)];
  const go = (step: number) => setIndex((i) => Math.max(0, Math.min(photos.length - 1, i + step)));
  const zoom = usePinchZoom({ resetKey: photo?.id ?? "", enabled: !photo?.isVideo, onSwipe: go });

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

  return createPortal(
    <div className="inspector photo-zoom" role="dialog" aria-modal="true" aria-label={photo.label ?? photo.fileName}>
      <div className="inspector-top">
        <span className="inspector-count">{photos.length > 1 ? `${index + 1} of ${photos.length}` : ""}</span>
        <button onClick={props.onClose}>Close</button>
      </div>
      <div className="inspector-stage" {...zoom.handlers}>
        {photo.isVideo ? <VideoPlayer key={photo.id} photo={photo} /> : <ZoomStill photo={photo} style={zoom.style} />}
        {index > 0 && <button className="inspector-nav prev" aria-label="Previous photo" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)}>‹</button>}
        {index < photos.length - 1 && <button className="inspector-nav next" aria-label="Next photo" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}>›</button>}
      </div>
      <p className="inspector-info muted small">
        {photo.isVideo ? "Tap the video for pause and sound." : "Pinch or double-tap to zoom."}
        {photos.length > 1 && " Swipe to see the others."}
      </p>
    </div>,
    document.body,
  );
}

function ZoomStill({ photo, style }: { photo: Photo; style: CSSProperties }) {
  const thumb = useImageUrl(photo, "thumb");
  const full = useImageUrl(photo, "full");
  const src = full ?? thumb;
  if (!src) return <div className="inspector-wait">Loading…</div>;
  return <img src={src} alt={photo.label ?? photo.fileName} draggable={false} style={style} />;
}
