import { useEffect, useRef } from "react";

// The Android Back button. The app's MainActivity asks window.organizeitBack() first; it
// closes the top-most open thing (a photo, a dialog, Select mode, the menu, a category) and
// returns false when nothing is open, so Back then leaves the app as usual.

/** How high a layer sits. A higher one closes first; among equals, the newest. */
export const BackLayer = { page: 0, select: 1, dialog: 2, menu: 3 } as const;

type Entry = { layer: number; close: () => void };
const stack: Entry[] = [];

/** Closes the top-most open layer. True if something was closed. */
export function goBack(): boolean {
  let top: Entry | undefined;
  for (const e of stack) if (!top || e.layer >= top.layer) top = e;
  if (!top) return false;
  top.close();
  return true;
}

declare global {
  interface Window {
    organizeitBack?: () => boolean;
  }
}
if (typeof window !== "undefined") window.organizeitBack = goBack;

/** Makes Back call `close` until the returned function is called. */
export function onBack(layer: number, close: () => void): () => void {
  const entry: Entry = { layer, close };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** While `open` is true, Back calls `close`. */
export function useBack(open: boolean, close: () => void, layer: number) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    return onBack(layer, () => latest.current());
  }, [open, layer]);
}
