import Anthropic from "@anthropic-ai/sdk";
import express, { type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClassifyError, ClassifyRequest, classifyPhoto } from "./classify";

// Small API server. The Anthropic key stays here so neither the website nor a future
// iOS/Android build ever ships it.

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// When APP_PASSCODE is set (always, for a public deployment), only people with the
// passcode can spend the server's Anthropic credits.
function requirePasscode(passcode: string | undefined): RequestHandler {
  return (req, res, next) => {
    if (!passcode || sameSecret(String(req.get("x-organizeit-passcode") ?? ""), passcode)) return next();
    res.status(401).json({ error: "Enter the OrganizeIt passcode to sort photos." });
  };
}

// Simple per-IP cap so a leaked passcode can't run up a large bill.
function rateLimit(perHour: number): RequestHandler {
  const hits = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > 3_600_000) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    if (++h.count <= perHour) return next();
    res.status(429).json({ error: "Hourly sorting limit reached. Try again later." });
  };
}

// The iOS/Android app runs from these origins inside its web view and calls this API.
const APP_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

const allowApp: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (origin && APP_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "content-type, x-organizeit-passcode");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
};

export function createApp(client: Anthropic | null, options: { passcode?: string; perHour?: number } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", allowApp);
  app.use(express.json({ limit: "15mb" }));
  const gate = requirePasscode(options.passcode || undefined);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ai: client !== null, passcodeRequired: Boolean(options.passcode) });
  });

  app.post("/api/unlock", gate, (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/classify", gate, rateLimit(options.perHour ?? 2000), async (req, res) => {
    if (!client) {
      res.status(503).json({ error: "AI sorting is not set up. Add ANTHROPIC_API_KEY to the server's environment." });
      return;
    }
    const parsed = ClassifyRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request." });
      return;
    }
    try {
      res.json(await classifyPhoto(client, parsed.data));
    } catch (err) {
      if (err instanceof ClassifyError) {
        res.status(err.status).json({ error: err.message });
      } else if (err instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: "The AI is busy. Retrying shortly." });
      } else if (err instanceof Anthropic.AuthenticationError) {
        res.status(503).json({ error: "The server's Anthropic API key was rejected." });
      } else if (err instanceof Anthropic.APIError) {
        res.status(502).json({ error: `AI request failed (${err.status ?? "network"}).` });
      } else {
        console.error(err);
        res.status(500).json({ error: "Unexpected server error." });
      }
    }
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const app = createApp(hasKey ? new Anthropic() : null, {
    passcode: process.env.APP_PASSCODE,
    perHour: Number(process.env.SORTS_PER_HOUR ?? 2000),
  });
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`OrganizeIt API on http://localhost:${port}${hasKey ? "" : " (no ANTHROPIC_API_KEY: AI sorting disabled)"}`);
    if (!process.env.APP_PASSCODE) console.log("APP_PASSCODE is not set: anyone who can reach this server can use the AI.");
  });
}
