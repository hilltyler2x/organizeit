// Browser helpers for videos added from files: read a video's size and length, grab still
// frames from it, and lay several frames out in one image for the classifier. Videos from the
// phone's library get the same from the native plugin instead.

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
}

/**
 * Where frames are taken from, as a share of the video's length: the middle of six equal
 * parts, so the very start and end (often black, shaky or a hand reaching for the phone) are
 * skipped. Matches the native plugins (VideoFrames.swift, MediaAssets.java).
 */
export const FRAME_POINTS = [1, 3, 5, 7, 9, 11].map((n) => n / 12);
/** A frame this flat (black, white, a fade) is swapped for one a little later. */
export const BLANK_SPREAD = 10;
/** Black lines between frames, so the AI reads them as separate pictures. */
export const GUTTER = 6;
/** Longest side of a video's frame grid for the classifier. Photos go at 768px. */
export const VIDEO_SHEET_SIDE = 1152;

/**
 * How six frames of a `width`×`height` video sit in a grid no bigger than `maxSide`. Tall
 * videos go three across and two down, wide ones two across and three down, so the grid comes
 * out near square and each frame gets as many pixels as possible.
 */
export function sheetLayout(width: number, height: number, maxSide: number, count = FRAME_POINTS.length) {
  const tall = height > width;
  const cols = Math.min(count, tall ? 3 : 2);
  const rows = Math.ceil(count / cols);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(1, (maxSide - (cols - 1) * GUTTER) / (cols * w), (maxSide - (rows - 1) * GUTTER) / (rows * h));
  const cellW = Math.max(1, Math.floor(w * scale));
  const cellH = Math.max(1, Math.floor(h * scale));
  return { cols, rows, cellW, cellH, width: cols * cellW + (cols - 1) * GUTTER, height: rows * cellH + (rows - 1) * GUTTER };
}

/** How much a frame's brightness varies (0–255). Near zero for a black or faded frame. */
export function spread(gray: ArrayLike<number>): number {
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < gray.length; i++) {
    sum += gray[i];
    sq += gray[i] * gray[i];
  }
  const mean = sum / Math.max(1, gray.length);
  return Math.sqrt(Math.max(0, sq / Math.max(1, gray.length) - mean * mean));
}

function load(file: Blob): Promise<{ video: HTMLVideoElement; done: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const done = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    video.onloadeddata = () => resolve({ video, done });
    video.onerror = () => {
      done();
      reject(new Error("This browser can't read that video format."));
    };
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    // A frame that can't be reached in time is drawn from wherever the video got to.
    const timer = setTimeout(finish, 5000);
    video.addEventListener("seeked", finish);
    video.currentTime = time;
  });
}

function draw(video: HTMLVideoElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", quality),
  );
}

/** Size, length and a poster frame (a JPEG no bigger than `maxSide`) for a video file. */
export async function readVideo(file: Blob, maxSide: number): Promise<VideoInfo & { poster: Blob }> {
  const { video, done } = await load(file);
  try {
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
    await seek(video, Math.min(0.5, video.duration / 10 || 0));
    return { width: video.videoWidth, height: video.videoHeight, durationMs, poster: await toJpeg(draw(video, maxSide), 0.78) };
  } finally {
    done();
  }
}

function isBlank(frame: HTMLCanvasElement): boolean {
  const tiny = document.createElement("canvas");
  tiny.width = tiny.height = 16;
  const ctx = tiny.getContext("2d")!;
  ctx.drawImage(frame, 0, 0, 16, 16);
  const px = ctx.getImageData(0, 0, 16, 16).data;
  const gray: number[] = [];
  for (let i = 0; i < px.length; i += 4) gray.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  return spread(gray) < BLANK_SPREAD;
}

/**
 * Six frames from across a video in one grid JPEG no bigger than `maxSide`, in time order
 * (left to right, then top to bottom). The classifier sees what the whole clip shows, not just
 * its first second. A blank frame (black, a fade) is replaced by one a little later.
 */
export async function frameSheet(file: Blob, maxSide: number, quality = 0.82): Promise<Blob> {
  const { video, done } = await load(file);
  try {
    const layout = sheetLayout(video.videoWidth, video.videoHeight, maxSide);
    const duration = video.duration || 0;
    const frames: HTMLCanvasElement[] = [];
    for (const point of FRAME_POINTS) {
      await seek(video, duration * point);
      let frame = draw(video, Math.max(layout.cellW, layout.cellH));
      if (isBlank(frame) && duration > 0) {
        await seek(video, duration * Math.min(0.97, point + 1 / 24));
        frame = draw(video, Math.max(layout.cellW, layout.cellH));
      }
      frames.push(frame);
    }
    const sheet = document.createElement("canvas");
    sheet.width = layout.width;
    sheet.height = layout.height;
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    frames.forEach((f, i) => {
      const x = (i % layout.cols) * (layout.cellW + GUTTER);
      const y = Math.floor(i / layout.cols) * (layout.cellH + GUTTER);
      ctx.drawImage(f, x, y, layout.cellW, layout.cellH);
    });
    return toJpeg(sheet, quality);
  } finally {
    done();
  }
}
