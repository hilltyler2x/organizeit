// Names for the Photos albums OrganizeIt fills so photos are easy to pick in other apps,
// such as when adding product photos in Big Cartel.

const MAX_ALBUM_NAME = 60;

/** The album name offered by default for a category, e.g. "Big Cartel - Bags". */
export function defaultAlbumName(categoryName: string): string {
  return tidyAlbumName(`Big Cartel - ${categoryName}`);
}

/** Collapses whitespace and trims, keeping names short enough for the Photos app. */
export function tidyAlbumName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_ALBUM_NAME).trim();
}
