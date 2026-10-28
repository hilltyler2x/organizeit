import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../core/storage";
import type { Photo } from "../core/types";
import { videoSource } from "../lib/media";
import { useImageUrl } from "./Thumb";

// The one video player, used everywhere a video is shown big enough to watch: the viewer,
// the "Where does this go?" sheet in To review, the duplicates inspector and the press-and-hold menu.

/** Plays a video; the poster frame shows while it loads, which can take a moment for a big one. */
export function VideoPlayer({ photo }: { photo: Photo }) {
  const poster = useImageUrl(photo, "thumb");
  const [src, setSrc] = useState<string>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let live = true;
    let release = () => {};
    videoSource(photo).then(
      (v) => {
        release = v.release;
        if (live) setSrc(v.url);
        else v.release();
      },
      (e) => live && setProblem(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
      release();
    };
  }, [photo.id]);
  if (problem) return <p className="video-wait">{problem}</p>;
  if (!src) return poster ? <img src={poster} alt={photo.label ?? photo.fileName} draggable={false} /> : <p className="video-wait">Loading video…</p>;
  return <VideoControls src={src} poster={poster} label={photo.label ?? photo.fileName} />;
}

const HIDE_AFTER_MS = 2500;

/**
 * Starts playing on its own. A tap shows pause/play, sound on/off and a scrubber; they fade
 * away again while it plays. If the phone won't autoplay with sound, it plays muted instead.
 */
function VideoControls({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number>();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [shown, setShown] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  const scheduleHide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShown(false), HIDE_AFTER_MS);
  };
  const show = () => {
    setShown(true);
    if (!video.current?.paused) scheduleHide();
  };

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.play().catch(() => {
      // Autoplay with sound was blocked: try again silently, and show the controls so the
      // sound button is easy to find.
      v.muted = true;
      setMuted(true);
      setShown(true);
      v.play().catch(() => setShown(true));
    });
    return () => window.clearTimeout(hideTimer.current);
  }, [src]);

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
      scheduleHide();
    } else {
      v.pause();
      window.clearTimeout(hideTimer.current);
    }
  };
  const toggleMute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.paused) scheduleHide();
  };

  return (
    <div className={`video-player${shown || !playing ? " show-controls" : ""}`}>
      <video
        ref={video}
        src={src}
        poster={poster}
        playsInline
        aria-label={label}
        onClick={() => (shown ? togglePlay() : show())}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setShown(true);
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
      />
      {/* Kept to themselves so dragging the scrubber never counts as a swipe in the duplicates inspector. */}
      <div className="video-controls" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button className="video-btn" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
            {playing ? (<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>) : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />}
          </svg>
        </button>
        <input
          className="video-seek"
          type="range"
          min={0}
          max={length || 0}
          step={0.1}
          value={Math.min(time, length || 0)}
          aria-label="Position"
          onChange={(e) => {
            const v = video.current;
            if (!v) return;
            v.currentTime = Number(e.currentTarget.value);
            setTime(v.currentTime);
            if (!v.paused) scheduleHide();
          }}
        />
        <span className="video-time">{formatDuration(time * 1000)}</span>
        <button className="video-btn" aria-label={muted ? "Sound on" : "Sound off"} onClick={toggleMute}>
          <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" fill="currentColor" />
            {muted ? <path d="m16 9.5 5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
