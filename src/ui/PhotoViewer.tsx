import { useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatDuration } from "../core/storage";
import type { Category, Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { BackLayer, useBack } from "./back";
import { MoveDialog } from "./MoveDialog";
import { PhotoMenu, copyAndShare, toast } from "./PhotoMenu";
import { useLongPress } from "./selection";
import { forgetImages, useImageUrl } from "./Thumb";
import { VideoPlayer } from "./VideoPlayer";
import { usePinchZoom } from "./zoom";

export function PhotoViewer(props: { lib: Library; photo: Photo; category?: Category; onClose: () => void; onEmptied: (deleted?: string) => void }) {
  const { lib, photo } = props;
  const url = useImageUrl(photo, photo.isVideo ? "thumb" : "full");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  useBack(true, props.onClose, BackLayer.dialog);
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const zoom = usePinchZoom({ resetKey: photo.id, enabled: !photo.isVideo });
  const hold = press.handlers(photo.id);

  const remove = async () => {
    // In the app the phone shows its own delete confirmation.
    if (!lib.native && !confirm(`Delete this ${photo.isVideo ? "video" : "photo"} from OrganizeIt?`)) return;
    setError("");
    try {
      const deleted = await lib.remove([photo.id]);
      if (!deleted) return;
      forgetImages([photo.id]);
      props.onEmptied(deleted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={photo.label ?? photo.fileName} onClick={(e) => e.stopPropagation()}>
        {photo.isVideo ? (
          // No press-and-hold here: holding would fight the video's own controls.
          <div className="viewer-image">
            <VideoPlayer photo={photo} />
          </div>
        ) : (
          // Pinch or double-tap to zoom; press and hold (without zooming) for the menu.
          <div
            className="viewer-image zoomable"
            {...zoom.handlers}
            onContextMenu={hold.onContextMenu}
            onPointerLeave={hold.onPointerLeave}
            onPointerDown={(e) => {
              zoom.handlers.onPointerDown(e);
              if (zoom.pinching()) press.cancel();
              else hold.onPointerDown(e);
            }}
            onPointerMove={(e) => {
              zoom.handlers.onPointerMove(e);
              hold.onPointerMove(e);
            }}
            onPointerUp={(e) => {
              zoom.handlers.onPointerUp(e);
              hold.onPointerUp(e);
            }}
            onPointerCancel={(e) => {
              zoom.handlers.onPointerCancel(e);
              hold.onPointerCancel(e);
            }}
          >
            {url && <img src={url} alt={photo.label ?? photo.fileName} draggable={false} style={zoom.style} />}
          </div>
        )}
        <div className="viewer-info">
          <h2>{photo.label ?? photo.fileName}</h2>
          <dl>
            {props.category && (<><dt>Category</dt><dd>{props.category.name}</dd></>)}
            {photo.confidence !== undefined && (<><dt>AI confidence</dt><dd>{Math.round(photo.confidence * 100)}%</dd></>)}
            <dt>File</dt><dd>{photo.fileName}</dd>
            <dt>Size</dt><dd>{formatBytes(photo.bytes)} · {photo.width}×{photo.height}</dd>
            {photo.isVideo && (<><dt>Length</dt><dd>{photo.durationMs ? formatDuration(photo.durationMs) : "Video"}</dd></>)}
            <dt>Date</dt><dd>{new Date(photo.takenAt).toLocaleDateString()}</dd>
            {photo.error && (<><dt>Problem</dt><dd className="error">{photo.error}</dd></>)}
          </dl>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button onClick={() => setMoving(true)}>Move</button>
            <button className="danger" onClick={remove}>Delete</button>
            <span className="spacer" />
            <button onClick={props.onClose}>Close</button>
          </div>
        </div>
      </div>
      {menu && (
        <PhotoMenu
          photo={photo}
          items={[
            ...copyAndShare(photo),
            { label: "Move", icon: "move", onSelect: () => setMoving(true) },
            { label: "Delete", icon: "delete", danger: true, onSelect: remove },
          ]}
          onClose={() => setMenu(false)}
        />
      )}
      {moving && (
        <MoveDialog
          count={1}
          categories={lib.categories}
          currentCategoryId={props.category?.id}
          defaultSection={props.category?.section ?? "products"}
          onClose={() => setMoving(false)}
          onMove={async (target) => {
            try {
              const also = await lib.move([photo.id], target);
              if (also) toast(`Also moved ${also} similar ${also === 1 ? "one" : "ones"} the AI had put in the same place`);
              setMoving(false);
              props.onEmptied();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setMoving(false);
            }
          }}
        />
      )}
    </div>,
    document.body,
  );
}
