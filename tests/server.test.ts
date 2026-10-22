import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/index";

// Fake Anthropic client that replays canned JSON answers and records requests.
function fakeClient(answers: object[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(structuredClone(params));
          const answer = answers.shift();
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }] };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

async function post(app: ReturnType<typeof createApp>, body: object, headers: Record<string, string> = {}, path = "/api/classify") {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const r = await fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  } finally {
    server.close();
  }
}

const req = { image: "aGVsbG8=", mediaType: "image/jpeg", fileName: "IMG_1.jpg", width: 1170, height: 2532, categories: [{ section: "products", name: "Bags" }] };

describe("POST /api/classify", () => {
  it("returns the classification", async () => {
    const { client, calls } = fakeClient([{ section: "business", category: "Receipts", label: "Target receipt", confidence: 0.93 }]);
    const r = await post(createApp(client), req);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ section: "business", category: "Receipts", label: "Target receipt", confidence: 0.93 });
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].output_config.format.type).toBe("json_schema");
  });

  it("re-asks once when the AI answers with a catch-all", async () => {
    const { client, calls } = fakeClient([
      { section: "products", category: "Other", label: "thing", confidence: 0.3 },
      { section: "products", category: "Sunglasses", label: "aviator sunglasses", confidence: 0.8 },
    ]);
    const r = await post(createApp(client), req);
    expect(r.body.category).toBe("Sunglasses");
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1).content).toMatch(/catch-all/);
  });

  it("uses the item description when the AI insists on a catch-all", async () => {
    const { client } = fakeClient([{ section: "products", category: "Misc", label: "phone case", confidence: 0.6 }]);
    const r = await post(createApp(client), req);
    expect(r.body.category).toBe("Phone Cases");
  });

  it("fails rather than filing into a catch-all", async () => {
    const { client } = fakeClient([
      { section: "products", category: "Other", label: "unknown item", confidence: 0.1 },
      { section: "products", category: "Uncategorized", label: "misc", confidence: 0.1 },
    ]);
    const r = await post(createApp(client), req);
    expect(r.status).toBe(422);
  });

  it("explains when no API key is configured", async () => {
    const r = await post(createApp(null), req);
    expect(r.status).toBe(503);
  });

  it("rejects malformed requests", async () => {
    const { client } = fakeClient([]);
    expect((await post(createApp(client), { image: "" })).status).toBe(400);
  });

  it("requires the passcode when one is set", async () => {
    const answer = { section: "products", category: "Bags", label: "tote", confidence: 0.9 };
    const { client, calls } = fakeClient([answer]);
    const app = createApp(client, { passcode: "s3cret" });
    expect((await post(app, req)).status).toBe(401);
    expect((await post(app, req, { "x-organizeit-passcode": "wrong" })).status).toBe(401);
    expect((await post(app, {}, { "x-organizeit-passcode": "wrong" }, "/api/unlock")).status).toBe(401);
    expect((await post(app, {}, { "x-organizeit-passcode": "s3cret" }, "/api/unlock")).status).toBe(200);
    expect(calls).toHaveLength(0);
    const ok = await post(app, req, { "x-organizeit-passcode": "s3cret" });
    expect(ok.status).toBe(200);
    expect(ok.body.category).toBe("Bags");
  });

  it("caps sorts per hour", async () => {
    const answer = { section: "products", category: "Bags", label: "tote", confidence: 0.9 };
    const { client } = fakeClient([answer, answer, answer]);
    const app = createApp(client, { perHour: 2 });
    expect((await post(app, req)).status).toBe(200);
    expect((await post(app, req)).status).toBe(200);
    expect((await post(app, req)).status).toBe(429);
  });
});

describe("CORS for the phone app", () => {
  it("lets the app's web view call the API, and nobody else", async () => {
    const app = createApp(null);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const pre = await fetch(`http://localhost:${port}/api/classify`, { method: "OPTIONS", headers: { origin: "capacitor://localhost" } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
      expect(pre.headers.get("access-control-allow-headers")).toContain("x-organizeit-passcode");
      const other = await fetch(`http://localhost:${port}/api/health`, { headers: { origin: "https://evil.example" } });
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      server.close();
    }
  });
});
