import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Photo } from "../core/types";
import { copyPhoto, sharePhoto } from "../lib/photoActions";
import { useImageUrl } from "./Thumb";

// The menu that comes up when you press and hold a photo, like in the iPhone Photos app: the
// photo lifts out over a blurred page with a list of actions under it.

export type MenuIcon = "copy" | "share" | "album" | "move" | "select" | "delete";

export interface MenuItem {
  label: string;
  icon: MenuIcon;
  danger?: boolean;
  onSelect: () => void;
}

const ICONS: Record<MenuIcon, ReactNode> = {
  copy: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  share: (<><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></>),
  album: (<><rect x="3" y="7" width="14" height="13" rx="2" /><path d="M7 4h12a2 2 0 0 1 2 2v10" /><path d="M10 11v5M7.5 13.5h5" /></>),
  move: (<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M10 13h6M13.5 10.5 16 13l-2.5 2.5" /></>),
  select: (<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>),
  delete: (<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></>),
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Copy and Share, which every photo's menu starts with. */
export function copyAndShare(photo: Photo): MenuItem[] {
  return [
    { label: "Copy", icon: "copy", onSelect: () => copyPhoto(photo).then(() => toast("Copied"), (e) => toast(message(e))) },
    { label: "Share", icon: "share", onSelect: () => sharePhoto(photo).catch((e) => toast(message(e))) },
  ];
}

export function PhotoMenu({ photo, items, onClose }: { photo: Photo; items: MenuItem[]; onClose: () => void }) {
  const thumb = useImageUrl(photo, "thumb");
  const full = useImageUrl(photo, "full");
  const first = useRef<HTMLButtonElement>(null);
  // The finger that opened the menu is still down when it appears, and lifting it sends a
  // click to whatever is under it now. Only clicks from a fresh touch (or the keyboard) count.
  const armed = useRef(false);
  const counts = (e: { detail: number }) => armed.current || e.detail === 0;

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    navigator.vibrate?.(10);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const src = full ?? thumb;
  return (
    <div
      className="photo-menu"
      onPointerDown={() => (armed.current = true)}
      onClick={(e) => {
        e.stopPropagation(); // the viewer behind closes on a click too
        if (counts(e)) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="photo-menu-body" onClick={(e) => e.stopPropagation()}>
        <div className="photo-menu-preview" style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : undefined }}>
          {src && <img src={src} alt={photo.label ?? photo.fileName} draggable={false} />}
        </div>
        <ul className="photo-menu-list" role="menu" aria-label={photo.label ?? photo.fileName}>
          {items.map((item, i) => (
            <li key={item.label}>
              <button
                ref={i === 0 ? first : undefined}
                role="menuitem"
                className={item.danger ? "danger" : ""}
                onClick={(e) => {
                  if (!counts(e)) return;
                  onClose();
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[item.icon]}
                </svg>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// A short note at the bottom of the screen, such as "Copied", that goes away by itself.
let showToast: (text: string) => void = () => {};

export function toast(text: string) {
  showToast(text);
}

export function Toaster() {
  const [text, setText] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    showToast = (t) => {
      setText(t);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(""), 2200);
    };
    return () => {
      showToast = () => {};
    };
  }, []);
  return text ? <div className="toast" role="status">{text}</div> : null;
}
