import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/index";
import { isBannedCategoryName } from "../src/core/categories";
import { syncWithDevice, type DeviceAsset } from "../src/core/library";
import { countItems, countLabel, deletedNotice, formatDuration, usageByCategory } from "../src/core/storage";
import { filesToPicked } from "../src/lib/photoSource";

let n = 0;
const newId = () => `id${++n}`;

const asset = (id: string, extra: Partial<DeviceAsset> = {}): DeviceAsset => ({
  id, fileName: `${id}.mov`, width: 1920, height: 1080, createdAt: 1, bytes: 50_000_000, mimeType: "video/quicktime", isScreenshot: false, ...extra,
});

describe("videos from the phone", () => {
  it("are queued like photos, keeping that they are videos and how long they run", () => {
    const c = syncWithDevice({ photos: [], categories: [] }, [asset("V", { isVideo: true, durationMs: 12_400 }), asset("P", { mimeType: "image/heic" })], newId);
    const [v, p] = c.state.photos;
    expect([v.status, v.isVideo, v.durationMs]).toEqual(["queued", true, 12_400]);
    expect(p.isVideo).toBeUndefined();
  });

  it("count toward their category's storage", () => {
    const cat = { id: "c", section: "products" as const, name: "Sneakers", seeded: false, createdAt: 0 };
    const base = { fileName: "", mimeType: "", width: 1, height: 1, takenAt: 0, importedAt: 0, status: "sorted" as const, categoryId: "c", source: { kind: "file" as const } };
    const [u] = usageByCategory([cat], [{ ...base, id: "1", bytes: 100 }, { ...base, id: "2", bytes: 900, isVideo: true }]);
    expect([u.count, u.videos, u.bytes]).toEqual([2, 1, 1000]);
  });
});

describe("wording", () => {
  it("names photos and videos", () => {
    expect(countLabel(3, 0)).toBe("3 photos");
    expect(countLabel(0, 1)).toBe("1 video");
    expect(countLabel(1, 2)).toBe("1 photo and 2 videos");
    expect(countItems([{ isVideo: true }, {}])).toBe("1 photo and 1 video");
    expect(deletedNotice(2, 2048, "android", 2)).toBe("Deleted 2 videos (2.0 KB) from your phone.");
  });

  it("formats lengths", () => {
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(75_400)).toBe("1:15");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});

describe("catch-all rule", () => {
  it("never files by media type", () => {
    for (const name of ["Videos", "Video Clips", "Clips", "Footage"]) expect(isBannedCategoryName(name)).toBe(true);
    expect(isBannedCategoryName("Sneakers")).toBe(false);
  });
});

describe("adding files on the website", () => {
  it("takes videos as well as photos", () => {
    const file = (name: string, type: string) => new File(["x"], name, { type });
    const picked = filesToPicked([file("a.jpg", "image/jpeg"), file("b.mov", "video/quicktime"), file("c.MP4", ""), file("d.txt", "text/plain")]);
    expect(picked.map((p) => [p.name, p.type])).toEqual([["a.jpg", "image/jpeg"], ["b.mov", "video/quicktime"], ["c.MP4", "video/mp4"]]);
  });
});

describe("sorting a video on the server", () => {
  it("tells the AI it is looking at frames from a video", async () => {
    const calls: any[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: any) => {
            calls.push(params);
            return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ section: "products", category: "Sneakers", label: "Jordan 1 on feet", confidence: 0.9 }) }] };
          },
        },
      },
    } as unknown as Anthropic;
    const server = createApp(client).listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const r = await fetch(`http://localhost:${port}/api/classify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: "aGVsbG8=", mediaType: "image/jpeg", fileName: "IMG_2.MOV", isVideo: true, durationSec: 14, categories: [] }),
      });
      expect((await r.json()).category).toBe("Sneakers");
    } finally {
      server.close();
    }
    const text = calls[0].messages[0].content.find((b: any) => b.type === "text").text;
    expect(text).toMatch(/This is a video \(14 seconds long\)/);
    expect(calls[0].system).toMatch(/2x2 grid/);
  });
});

describe("duplicates", () => {
  it("never pairs a video with a photo, and only pairs videos of the same length", async () => {
    const { findDuplicates, makeFingerprint } = await import("../src/core/duplicates");
    const hash = makeFingerprint("3c7e1f0f8f1e3c78", Array.from({ length: 256 }, (_, i) => (i * 97) % 256));
    const item = (id: string, extra: object = {}) => ({
      id, fileName: id, mimeType: "", bytes: 1, width: 400, height: 300, takenAt: 0, importedAt: 0, status: "sorted" as const,
      hash, source: { kind: "file" as const }, ...extra,
    });
    expect(findDuplicates([item("photo"), item("video", { isVideo: true, durationMs: 5000 })])).toHaveLength(0);
    expect(findDuplicates([item("v1", { isVideo: true, durationMs: 5000 }), item("v2", { isVideo: true, durationMs: 20000 })])).toHaveLength(0);
    expect(findDuplicates([item("v1", { isVideo: true, durationMs: 5000 }), item("v2", { isVideo: true, durationMs: 5400 })])).toHaveLength(1);
  });
});
