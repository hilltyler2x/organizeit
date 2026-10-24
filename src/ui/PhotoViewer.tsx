import { useState } from "react";
import { formatBytes } from "../core/storage";
import type { Category, Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { BackLayer, useBack } from "./back";
import { MoveDialog } from "./MoveDialog";
import { PhotoMenu, copyAndShare } from "./PhotoMenu";
import { useLongPress } from "./selection";
import { forgetImages, useImageUrl } from "./Thumb";

export function PhotoViewer(props: { lib: Library; photo: Photo; category?: Category; onClose: () => void; onEmptied: (deleted?: string) => void }) {
  const { lib, photo } = props;
  const url = useImageUrl(photo, "full");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  useBack(true, props.onClose, BackLayer.dialog);
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => setMenu(true));

  const remove = async () => {
    // In the app the phone shows its own delete confirmation.
    if (!lib.native && !confirm("Delete this photo from OrganizeIt?")) return;
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

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={photo.label ?? photo.fileName} onClick={(e) => e.stopPropagation()}>
        <div className="viewer-image" {...press.handlers(photo.id)}>
          {url && <img src={url} alt={photo.label ?? photo.fileName} draggable={false} />}
        </div>
        <div className="viewer-info">
          <h2>{photo.label ?? photo.fileName}</h2>
          <dl>
            {props.category && (<><dt>Category</dt><dd>{props.category.name}</dd></>)}
            {photo.confidence !== undefined && (<><dt>AI confidence</dt><dd>{Math.round(photo.confidence * 100)}%</dd></>)}
            <dt>File</dt><dd>{photo.fileName}</dd>
            <dt>Size</dt><dd>{formatBytes(photo.bytes)} · {photo.width}×{photo.height}</dd>
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
              await lib.move([photo.id], target);
              setMoving(false);
              props.onEmptied();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setMoving(false);
            }
          }}
        />
      )}
    </div>
  );
}
