import { useState } from "react";
import { createPortal } from "react-dom";
import { defaultAlbumName, tidyAlbumName } from "../core/albums";
import { albumsCopyPhotos } from "../lib/photoLibrary";
import { BackLayer, useBack } from "./back";

/** Asks which Photos album to put the selected photos in, e.g. one per Big Cartel product. */
export function AlbumDialog(props: {
  count: number;
  categoryName: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultAlbumName(props.categoryName));
  const [saving, setSaving] = useState(false);
  const title = tidyAlbumName(name);
  useBack(true, props.onClose, BackLayer.dialog);

  return createPortal(
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send to Big Cartel album" onClick={(e) => e.stopPropagation()}>
        <h2>Send {props.count} photo{props.count === 1 ? "" : "s"} to an album</h2>
        {albumsCopyPhotos ? (
          <p className="muted">
            OrganizeIt puts copies of them in an album (a folder in Pictures › OrganizeIt) that Google Photos and your gallery
            show. When you add a product in Big Cartel, open this album to pick them. Android can't make albums without copying,
            so the copies use extra space; delete the album when you're done with it.
          </p>
        ) : (
          <p className="muted">
            OrganizeIt adds them to an album in your Photos app. When you add a product in Big Cartel, open this album to pick
            them. It doesn't copy the photos or use extra space.
          </p>
        )}
        <form
          className="new-category"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title || saving) return;
            setSaving(true);
            props.onSave(title).finally(() => setSaving(false));
          }}
        >
          <label htmlFor="album-name">Album name (tip: use the product's name)</label>
          <div className="row">
            <input id="album-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
            <button className="primary" type="submit" disabled={!title || saving}>
              {saving ? "Adding…" : "Add to album"}
            </button>
          </div>
        </form>
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
