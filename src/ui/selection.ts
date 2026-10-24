import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";

// Helpers that let the person start selecting photos without scrolling back to the top.

/** True once the element has scrolled out of view, so a floating Select button can stand in for it. */
export function useScrolledPast(ref: RefObject<HTMLElement | null>) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return past;
}

const HOLD_MS = 450;

/**
 * Press and hold a photo to start selecting with it. Spread the returned handlers on the
 * tile, and call `consumed()` in its click handler: it is true for the click that ends a hold.
 */
export function useLongPress(onHold: (id: string) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    handlers: (id: string) => ({
      onPointerDown: (e: PointerEvent) => {
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          held.current = true;
          start.current = null;
          onHold(id);
        }, HOLD_MS);
      },
      // Scrolling the grid is not a hold.
      onPointerMove: (e: PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
    }),
    consumed: () => {
      const was = held.current;
      held.current = false;
      return was;
    },
  };
}
