import { useEffect, useState } from "react";
import { formatDuration } from "../core/storage";
import type { Photo } from "../core/types";
import { fullImage, thumbnail } from "../lib/media";

// Object URLs for stored images, cached for the session.
const cache = new Map<string, { thumb?: string; full?: string }>();

export function useImageUrl(photo: Photo, kind: "thumb" | "full") {
  const id = photo.id;
  const [url, setUrl] = useState(() => cache.get(id)?.[kind]);
  useEffect(() => {
    if (cache.get(id)?.[kind]) {
      setUrl(cache.get(id)![kind]);
      return;
    }
    let live = true;
    (kind === "thumb" ? thumbnail(photo) : fullImage(photo))
      .then((blob) => {
        if (!blob || !live) return;
        const entry = cache.get(id) ?? {};
        entry[kind] = URL.createObjectURL(blob);
        cache.set(id, entry);
        setUrl(entry[kind]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, kind]);
  return url;
}

export function forgetImages(ids: string[]) {
  for (const id of ids) {
    const e = cache.get(id);
    if (e?.thumb) URL.revokeObjectURL(e.thumb);
    if (e?.full) URL.revokeObjectURL(e.full);
    cache.delete(id);
  }
}

export function Thumb({ photo, alt }: { photo: Photo; alt: string }) {
  const url = useImageUrl(photo, "thumb");
  const image = url ? <img src={url} alt={alt} loading="lazy" draggable={false} /> : <div className="thumb-placeholder" />;
  if (!photo.isVideo) return image;
  return (
    <>
      {image}
      <span className="video-badge" aria-label="Video">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l11-6.5Z" fill="currentColor" /></svg>
        {photo.durationMs ? <span className="video-length">{formatDuration(photo.durationMs)}</span> : null}
      </span>
    </>
  );
}
