import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";

// Pinch, double-tap or scroll-wheel to zoom into a photo, and drag to look around it once
// zoomed. Spread `handlers` on the box the photo sits in (it needs `touch-action: none` and
// `overflow: hidden`) and put `style` on the <img>. Works the same with fingers on iPhone and
// Android and with a mouse on the website.

export const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const SWIPE_PX = 60;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };

interface Size {
  w: number;
  h: number;
}

/**
 * Keep the photo covering the box: it can't be zoomed out past fitting, and can't be dragged so
 * far that an edge comes away from the side of the box.
 */
export function clampView(view: View, image: Size, box: Size): View {
  const scale = Math.max(1, Math.min(MAX_ZOOM, view.scale));
  if (scale === 1) return FIT;
  const maxX = Math.max(0, (image.w * scale - box.w) / 2);
  const maxY = Math.max(0, (image.h * scale - box.h) / 2);
  const clamp = (v: number, max: number) => (max === 0 ? 0 : Math.max(-max, Math.min(max, v)));
  return { scale, x: clamp(view.x, maxX), y: clamp(view.y, maxY) };
}

/** Zoom to `scale`, keeping the spot at (px, py) (measured from the box's centre) where it is. */
export function zoomAround(view: View, px: number, py: number, scale: number): View {
  if (scale <= 1) return FIT;
  return { scale, x: px - ((px - view.x) * scale) / view.scale, y: py - ((py - view.y) * scale) / view.scale };
}

export function usePinchZoom(opts: {
  /** Zoom resets whenever this changes, e.g. the photo's id. */
  resetKey: string;
  /** Off for videos, which need their own taps. */
  enabled?: boolean;
  /** Called with 1 (next) or -1 (previous) for a sideways swipe while not zoomed in. */
  onSwipe?: (step: 1 | -1) => void;
}) {
  const enabled = opts.enabled ?? true;
  const [view, setViewRaw] = useState<View>(FIT);
  const box = useRef<HTMLElement | null>(null);
  // Fingers (or the mouse) on the photo, and where the current gesture began.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; x: number; y: number; dist: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    setViewRaw(FIT);
    pointers.current.clear();
    gesture.current = null;
  }, [opts.resetKey]);

  const setView = (next: View) => {
    const el = box.current;
    const img = el?.querySelector("img");
    // offsetWidth is the laid-out size, before the zoom transform.
    setViewRaw(el && img ? clampView(next, { w: img.offsetWidth, h: img.offsetHeight }, { w: el.clientWidth, h: el.clientHeight }) : next);
  };

  const center = () => {
    const pts = [...pointers.current.values()];
    const x = pts.reduce((n, p) => n + p.x, 0) / pts.length;
    const y = pts.reduce((n, p) => n + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { x, y, dist };
  };

  const begin = () => {
    gesture.current = { view: viewRef.current, ...center(), moved: gesture.current?.moved ?? false };
  };

  const zoomAt = (clientX: number, clientY: number, scale: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView(zoomAround(viewRef.current, clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), scale));
  };

  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      box.current = e.currentTarget;
      // A video needs its own taps (to show its controls), so the box doesn't capture them.
      if (enabled) e.currentTarget.setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) gesture.current = null;
      begin();
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      const c = center();
      if (Math.hypot(c.x - g.x, c.y - g.y) > 6 || (c.dist && Math.abs(c.dist - g.dist) > 6)) g.moved = true;
      if (!enabled) return; // a swipe still counts, but nothing zooms
      if (pointers.current.size > 1 && g.dist) {
        const scale = Math.max(1, Math.min(MAX_ZOOM, (g.view.scale * c.dist) / g.dist));
        setView(scale === 1 ? FIT : { scale, x: g.view.x + (c.x - g.x), y: g.view.y + (c.y - g.y) });
      } else if (g.view.scale > 1) {
        setView({ ...g.view, x: g.view.x + (c.x - g.x), y: g.view.y + (c.y - g.y) });
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
    onWheel: (e: WheelEvent<HTMLElement>) => {
      if (!enabled) return;
      box.current = e.currentTarget;
      const scale = Math.max(1, Math.min(MAX_ZOOM, viewRef.current.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      zoomAt(e.clientX, e.clientY, scale);
    },
  };

  const end = (e: PointerEvent<HTMLElement>, lifted: boolean) => {
    const g = gesture.current;
    const point = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      begin(); // one finger lifted from a pinch: carry on panning from here
      return;
    }
    gesture.current = null;
    if (!lifted || !g || !point) return;
    // Not zoomed in: a sideways swipe goes to the next or previous photo.
    if (opts.onSwipe && g.view.scale === 1 && viewRef.current.scale === 1) {
      const dx = point.x - g.x;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(point.y - g.y)) {
        opts.onSwipe(dx < 0 ? 1 : -1);
        return;
      }
    }
    if (g.moved || !enabled) return;
    // Double tap: zoom in on that spot, or back out.
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      zoomAt(point.x, point.y, viewRef.current.scale > 1 ? 1 : DOUBLE_TAP_ZOOM);
    } else {
      lastTap.current = now;
    }
  };

  return {
    view,
    zoomed: view.scale > 1,
    /** True while two or more fingers are down, i.e. a pinch rather than a hold. */
    pinching: () => pointers.current.size > 1,
    handlers,
    style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
  };
}
