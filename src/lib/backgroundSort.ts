import { registerPlugin } from "@capacitor/core";
import type { BackgroundResult } from "../core/background";
import type { LessonForPrompt } from "../core/lessons";
import type { Section } from "../core/types";

// Bridge to the background sorter in native/photo-library. The phone keeps sorting after the
// app is closed (as far as iOS and Android allow) using this snapshot, and holds what it
// sorted until the app takes it back. Only available inside the iOS/Android app.

export interface BackgroundSortConfig {
  apiUrl: string;
  passcode: string;
  /** Who the server checks the subscription of. */
  userId: string;
  categories: { section: Section; name: string }[];
  lessons: LessonForPrompt[];
  /** Phone photo ids waiting to be sorted, newest first. */
  queued: string[];
  /** Creation time (ms) of the newest phone photo the app knows about. */
  knownUpTo: number;
}

export interface BackgroundSortStatus {
  /** iPhone: Settings → General → Background App Refresh. Android: battery restrictions. */
  backgroundRefresh: "on" | "off" | "restricted";
  /** Sorting carries on after the app is closed (iOS 26+, Android), not just ~30 seconds. */
  keepsGoingAfterClose: boolean;
  /** What background sorting last did, and when (ms). */
  last?: string;
  lastAt?: number;
}

interface BackgroundSortPlugin {
  configure(config: BackgroundSortConfig): Promise<void>;
  takeResults(): Promise<{ results: BackgroundResult[] }>;
  status(): Promise<BackgroundSortStatus>;
}

export const BackgroundSort = registerPlugin<BackgroundSortPlugin>("BackgroundSort");
