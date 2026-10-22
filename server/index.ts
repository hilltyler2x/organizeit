import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClassifyError, ClassifyRequest, classifyPhoto } from "./classify";

// Small API server. The Anthropic key stays here so neither the website nor a future
// iOS/Android build ever ships it.

export function createApp(client: Anthropic | null) {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ai: client !== null });
  });

  app.post("/api/classify", async (req, res) => {
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
  const app = createApp(hasKey ? new Anthropic() : null);
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`OrganizeIt API on http://localhost:${port}${hasKey ? "" : " (no ANTHROPIC_API_KEY: AI sorting disabled)"}`);
  });
}
