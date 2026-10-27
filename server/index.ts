import Anthropic from "@anthropic-ai/sdk";
import express, { type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClassifyBatchRequest, ClassifyError, ClassifyRequest, classifyBatch, classifyPhoto } from "./classify";
import {
  PlanUnavailable,
  cached,
  freeKey,
  limitFor,
  memoryUsage,
  postgresUsage,
  revenueCat,
  usageKey,
  validUserId,
  type SubscriptionOptions,
} from "./subscriptions";

// Small API server. The Anthropic key stays here so neither the website nor a future
// iOS/Android build ever ships it.

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const MAX_WRONG_PASSCODES = 10;
const TOO_MANY_WRONG = "Too many wrong passcodes. Try again in an hour.";

/**
 * Checks the passcode a request carries. After MAX_WRONG_PASSCODES wrong tries in an hour an
 * address is shut out for the rest of that hour, even with the right one, so a short passcode
 * can't be found by trying them all.
 */
function passcodeChecker(passcode: string | undefined) {
  const wrong = new Map<string, { start: number; count: number }>();
  return (req: Parameters<RequestHandler>[0]): "none" | "ok" | "wrong" | "blocked" => {
    const given = String(req.get("x-organizeit-passcode") ?? "");
    if (!passcode || !given) return "none";
    const key = req.ip ?? "unknown";
    const now = Date.now();
    let w = wrong.get(key);
    if (w && now - w.start > 3_600_000) wrong.delete(key), (w = undefined);
    if (w && w.count >= MAX_WRONG_PASSCODES) return "blocked";
    if (sameSecret(given, passcode)) return "ok";
    if (!w) {
      if (wrong.size > 100_000) wrong.clear();
      wrong.set(key, (w = { start: now, count: 0 }));
    }
    w.count++;
    return "wrong";
  };
}
type PasscodeCheck = ReturnType<typeof passcodeChecker>;

// When APP_PASSCODE is set (always, for a public deployment), only people with the
// passcode can spend the server's Anthropic credits.
function requirePasscode(passcode: string | undefined, check: PasscodeCheck): RequestHandler {
  return (req, res, next) => {
    if (!passcode) return next();
    const result = check(req);
    if (result === "ok") return next();
    if (result === "blocked") {
      res.status(429).json({ error: TOO_MANY_WRONG });
      return;
    }
    res.status(401).json({ error: "Enter the OrganizeIt passcode to sort photos." });
  };
}

// Who may sort. The passcode always works (the owner, and the website). With subscriptions on,
// a phone without it needs an active subscription, and each billing period has an allowance:
// the request is charged for its photos up front and turned down with 402 once it is used up.
function requireAccess(passcode: string | undefined, subs: SubscriptionOptions | undefined, check: PasscodeCheck): RequestHandler {
  // Free photos are handed out per phone id, which a script could make up. A per-IP daily
  // ceiling keeps that from adding up to much.
  const freeByIp = new Map<string, { day: number; count: number }>();
  const freeFromIp = (ip: string, cost: number) => {
    const day = Math.floor(Date.now() / 86_400_000);
    let f = freeByIp.get(ip);
    if (!f || f.day !== day) {
      if (freeByIp.size > 100_000) freeByIp.clear();
      freeByIp.set(ip, (f = { day, count: 0 }));
    }
    // Generous, since a whole mobile carrier's customers can share one address.
    if (f.count + cost > (subs?.freeLimit ?? 0) * 50) return false;
    f.count += cost;
    return true;
  };
  return async (req, res, next) => {
    const given = check(req);
    if (given === "ok") return next();
    if (given === "blocked") {
      res.status(429).json({ error: TOO_MANY_WRONG });
      return;
    }
    if (!subs) {
      if (!passcode) return next();
      res.status(401).json({ error: "Enter the OrganizeIt passcode to sort photos." });
      return;
    }
    const userId = String(req.get("x-organizeit-user") ?? "");
    if (!validUserId(userId)) {
      res.status(402).json({ error: "Subscribe to start sorting.", reason: "subscribe" });
      return;
    }
    try {
      const plan = await subs.plans.plan(userId);
      const cost = Array.isArray(req.body?.photos) ? Math.max(1, req.body.photos.length) : 1;
      if (!plan.active) {
        // The free preview: the first photos on each phone are sorted before asking for a card.
        const key = freeKey(userId);
        if (
          subs.freeLimit > 0 &&
          (await subs.usage.used(key)) + cost <= subs.freeLimit &&
          freeFromIp(req.ip ?? "unknown", cost) &&
          (await subs.usage.add(key, cost, subs.freeLimit)) !== null
        ) {
          return next();
        }
        res.status(402).json({
          error: subs.freeLimit > 0 ? `That's your ${subs.freeLimit} free photos. Subscribe to sort the rest.` : "Subscribe to start sorting.",
          reason: "subscribe",
        });
        return;
      }
      const limit = limitFor(subs, plan);
      if (limit > 0) {
        if ((await subs.usage.add(usageKey(userId, plan), cost, limit)) === null) {
          res.status(402).json({
            error: plan.intro
              ? `Your first month includes ${limit.toLocaleString("en-US")} photos. The rest are sorted when your subscription renews.`
              : `You've sorted this month's ${limit.toLocaleString("en-US")} photos. The rest are sorted when your subscription renews.`,
            reason: "limit",
          });
          return;
        }
      }
      next();
    } catch (err) {
      if (!(err instanceof PlanUnavailable)) console.error(err);
      res.status(502).json({ error: "Couldn't check your subscription. Try again in a moment.", reason: "plan-check" });
    }
  };
}

// Simple cap on photos sorted per hour, per subscriber (or per IP without one), so a leaked
// passcode or one runaway phone can't run up a large bill.
function rateLimit(perHour: number): RequestHandler {
  const hits = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const key = req.get("x-organizeit-user") || req.ip || "unknown";
    const cost = Array.isArray(req.body?.photos) ? Math.max(1, req.body.photos.length) : 1;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > 3_600_000) hits.set(key, (h = { start: now, count: 0 }));
    if (h.count + cost <= perHour) {
      h.count += cost;
      return next();
    }
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
    res.set("Access-Control-Allow-Headers", "content-type, x-organizeit-passcode, x-organizeit-user");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
};

export function createApp(
  client: Anthropic | null,
  options: { passcode?: string; perHour?: number; subscriptions?: SubscriptionOptions } = {},
) {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api", allowApp);
  app.use(express.json({ limit: "25mb" }));
  const check = passcodeChecker(options.passcode || undefined);
  const gate = requirePasscode(options.passcode || undefined, check);
  const subs = options.subscriptions;
  const access = requireAccess(options.passcode || undefined, subs, check);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ai: client !== null, passcodeRequired: Boolean(options.passcode), subscriptions: Boolean(subs) });
  });

  // The app asks this on launch and right after a purchase (?fresh=1 skips the cached answer).
  app.get("/api/subscription", async (req, res) => {
    const userId = String(req.get("x-organizeit-user") ?? "");
    if (!subs || !validUserId(userId)) {
      res.json({ active: false, intro: false, used: 0, limit: 0, expires: null, cancelled: false, freeUsed: 0, freeLimit: 0 });
      return;
    }
    if (req.query.fresh) subs.plans.forget?.(userId);
    try {
      const plan = await subs.plans.plan(userId);
      const [used, freeUsed] = await Promise.all([plan.active ? subs.usage.used(usageKey(userId, plan)) : 0, subs.usage.used(freeKey(userId))]);
      res.json({
        active: plan.active,
        intro: plan.intro,
        used,
        limit: plan.active ? limitFor(subs, plan) : 0,
        expires: plan.expires,
        cancelled: plan.cancelled,
        freeUsed,
        freeLimit: subs.freeLimit,
      });
    } catch (err) {
      if (!(err instanceof PlanUnavailable)) console.error(err);
      res.status(503).json({ error: "Couldn't check your subscription. Try again in a moment." });
    }
  });

  app.post("/api/unlock", gate, (_req, res) => {
    res.json({ ok: true });
  });

  const limit = rateLimit(options.perHour ?? 10_000);

  const handle = (run: (client: Anthropic, body: unknown) => Promise<unknown>): RequestHandler => async (req, res) => {
    if (!client) {
      res.status(503).json({ error: "AI sorting is not set up. Add ANTHROPIC_API_KEY to the server's environment." });
      return;
    }
    try {
      res.json(await run(client, req.body));
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
  };

  const invalid = new ClassifyError("Invalid request.", 400);

  app.post("/api/classify", access, limit, handle(async (c, body) => {
    const parsed = ClassifyRequest.safeParse(body);
    if (!parsed.success) throw invalid;
    return classifyPhoto(c, parsed.data);
  }));

  // Several photos per request: what the app uses while it is open.
  app.post("/api/classify-batch", access, limit, handle(async (c, body) => {
    const parsed = ClassifyBatchRequest.safeParse(body);
    if (!parsed.success) throw invalid;
    return { results: await classifyBatch(c, parsed.data) };
  }));

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const rcKey = process.env.REVENUECAT_SECRET_KEY;
  const subscriptions: SubscriptionOptions | undefined = rcKey
    ? {
        plans: cached(revenueCat(rcKey, process.env.REVENUECAT_ENTITLEMENT || "organizeit_pro")),
        // A database that can't be reached doesn't stop the server; counts fall back to memory.
        usage: process.env.DATABASE_URL
          ? await postgresUsage(process.env.DATABASE_URL).catch((err) => {
              console.error("Couldn't use DATABASE_URL, keeping photo counts in memory:", err.message);
              return memoryUsage();
            })
          : memoryUsage(),
        freeLimit: Number(process.env.FREE_SORT_LIMIT ?? 100),
        introLimit: Number(process.env.INTRO_SORT_LIMIT ?? 2000),
        monthlyLimit: Number(process.env.MONTHLY_SORT_LIMIT ?? 0),
      }
    : undefined;
  const app = createApp(hasKey ? new Anthropic() : null, {
    passcode: process.env.APP_PASSCODE,
    perHour: Number(process.env.SORTS_PER_HOUR ?? 10_000),
    subscriptions,
  });
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`OrganizeIt API on http://localhost:${port}${hasKey ? "" : " (no ANTHROPIC_API_KEY: AI sorting disabled)"}`);
    if (!process.env.APP_PASSCODE && !rcKey) console.log("APP_PASSCODE is not set: anyone who can reach this server can use the AI.");
    if (rcKey) console.log(`Subscriptions on (entitlement ${process.env.REVENUECAT_ENTITLEMENT || "organizeit_pro"}).`);
    if (rcKey && !process.env.DATABASE_URL) console.log("DATABASE_URL is not set: monthly sorting allowances reset whenever the server restarts.");
  });
}
