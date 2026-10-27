// Browser helpers for videos added from files: read a video's size and length, grab still
// frames from it, and lay several frames out in one image for the classifier. Videos from the
// phone's library get the same from the native plugin instead.

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
}

/** Where frames are taken from, as a share of the video's length. */
export const FRAME_POINTS = [0.1, 0.37, 0.63, 0.9];

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

/**
 * Four frames from across a video in a 2×2 grid, as one JPEG no bigger than `maxSide`. The
 * classifier sees what the whole clip shows, not just its first second.
 */
export async function frameSheet(file: Blob, maxSide: number, quality = 0.8): Promise<Blob> {
  const { video, done } = await load(file);
  try {
    const cell = Math.round(maxSide / 2);
    const frames: HTMLCanvasElement[] = [];
    for (const point of FRAME_POINTS) {
      await seek(video, (video.duration || 0) * point);
      frames.push(draw(video, cell));
    }
    const { width, height } = frames[0];
    const sheet = document.createElement("canvas");
    sheet.width = width * 2;
    sheet.height = height * 2;
    const ctx = sheet.getContext("2d")!;
    frames.forEach((f, i) => ctx.drawImage(f, (i % 2) * width, Math.floor(i / 2) * height, width, height));
    return toJpeg(sheet, quality);
  } finally {
    done();
  }
}
