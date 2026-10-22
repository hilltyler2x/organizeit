import { useState } from "react";
import { formatBytes } from "../core/storage";
import type { Category, Photo } from "../core/types";
import type { Library } from "../lib/useLibrary";
import { MoveDialog } from "./MoveDialog";
import { forgetImages, useImageUrl } from "./Thumb";

export function PhotoViewer(props: { lib: Library; photo: Photo; category?: Category; onClose: () => void; onEmptied: () => void }) {
  const { lib, photo } = props;
  const url = useImageUrl(photo, "full");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={photo.label ?? photo.fileName} onClick={(e) => e.stopPropagation()}>
        <div className="viewer-image">{url && <img src={url} alt={photo.label ?? photo.fileName} />}</div>
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
            <button
              className="danger"
              onClick={async () => {
                if (!lib.native && !confirm("Delete this photo from OrganizeIt?")) return;
                if (!(await lib.remove([photo.id]))) return;
                forgetImages([photo.id]);
                props.onEmptied();
              }}
            >
              Delete
            </button>
            <span className="spacer" />
            <button onClick={props.onClose}>Close</button>
          </div>
        </div>
      </div>
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
