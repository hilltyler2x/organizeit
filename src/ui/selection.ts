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
 * Press and hold a photo (or right-click it with a mouse) to bring up its menu. Spread the
 * returned handlers on the tile, and call `consumed()` in its click handler: it is true for
 * the click that ends a hold.
 */
export function useLongPress(onHold: (id: string) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const held = useRef(false);
  const touch = useRef(false);

  const cancel = (e: PointerEvent) => {
    if (start.current?.pointer !== e.pointerId) return; // e.g. a mouse leaving while a finger holds
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    handlers: (id: string) => ({
      onPointerDown: (e: PointerEvent) => {
        held.current = false;
        touch.current = e.pointerType !== "mouse";
        if (!touch.current) return;
        start.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          held.current = true;
          start.current = null;
          onHold(id);
        }, HOLD_MS);
      },
      // Scrolling the grid is not a hold.
      onPointerMove: (e: PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(e);
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        if (!touch.current) onHold(id); // a touch hold already opened it
      },
    }),
    /** Stop a hold that has started, e.g. when a second finger turns it into a pinch. */
    cancel: () => {
      window.clearTimeout(timer.current);
      start.current = null;
    },
    consumed: () => {
      const was = held.current;
      held.current = false;
      return was;
    },
  };
}
