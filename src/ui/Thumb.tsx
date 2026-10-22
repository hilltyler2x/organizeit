import { useEffect, useState } from "react";
import { getBlobs } from "../lib/db";

// Object URLs for stored images, cached for the session.
const cache = new Map<string, { thumb?: string; full?: string }>();

export function useImageUrl(id: string, kind: "thumb" | "full") {
  const [url, setUrl] = useState(() => cache.get(id)?.[kind]);
  useEffect(() => {
    if (cache.get(id)?.[kind]) {
      setUrl(cache.get(id)![kind]);
      return;
    }
    let live = true;
    getBlobs(id).then((b) => {
      if (!b || !live) return;
      const entry = cache.get(id) ?? {};
      entry[kind] = URL.createObjectURL(kind === "thumb" ? b.thumb : b.original);
      cache.set(id, entry);
      setUrl(entry[kind]);
    });
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

export function Thumb({ id, alt }: { id: string; alt: string }) {
  const url = useImageUrl(id, "thumb");
  return url ? <img src={url} alt={alt} loading="lazy" draggable={false} /> : <div className="thumb-placeholder" />;
}
