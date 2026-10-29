// Where photos come from. The website uses the browser's photo picker, which on iPhone
// and Android opens the Photos library directly with multi-select. A native build adds a
// second implementation backed by the device photo library (e.g. a Capacitor media
// plugin) that can also delete the originals; the rest of the app does not change.

export interface PickedPhoto {
  file: Blob;
  name: string;
  type: string;
  lastModified: number;
  source: { kind: "file" } | { kind: "native"; assetId: string };
}

export interface PhotoSource {
  /** Human name for the connect button. */
  label: string;
  pick(): Promise<PickedPhoto[]>;
  /** True when deleting in OrganizeIt can also delete the original from the device library. */
  canDeleteOriginals: boolean;
}

const ACCEPTED = /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/(mp4|quicktime|webm|x-m4v|3gpp))$/i;
const VIDEO_NAME = /\.(mp4|mov|m4v|webm|3gp)$/i;

export function filesToPicked(files: Iterable<File>): PickedPhoto[] {
  return [...files]
    .filter((f) => ACCEPTED.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name) || VIDEO_NAME.test(f.name))
    .map((f) => ({
      file: f,
      name: f.name,
      type: f.type || (VIDEO_NAME.test(f.name) ? "video/mp4" : "image/jpeg"),
      lastModified: f.lastModified,
      source: { kind: "file" as const },
    }));
}

export function isVideoType(type: string): boolean {
  return type.startsWith("video/");
}

export function browserPhotoSource(options: { folder?: boolean } = {}): PhotoSource {
  return {
    label: options.folder ? "Add a folder" : "Add photos and videos",
    canDeleteOriginals: false,
    pick: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/*";
        input.multiple = true;
        if (options.folder) input.setAttribute("webkitdirectory", "");
        input.onchange = () => resolve(filesToPicked(input.files ?? []));
        input.oncancel = () => resolve([]);
        input.click();
      }),
  };
}
