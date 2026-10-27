import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/index";
import { cached, memoryUsage, planFrom, revenueCat, type Plan, type SubscriptionOptions } from "../server/subscriptions";

const answer = { section: "products", category: "Bags", label: "tote bag", confidence: 0.9 };
const client = {
  beta: {
    messages: {
      create: async (params: any) => {
        const n = (params.messages[0].content as any[]).filter((c) => c.type === "image").length;
        const text = n > 1 ? JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ index: i, ...answer })) }) : JSON.stringify(answer);
        return { stop_reason: "end_turn", content: [{ type: "text", text }] };
      },
    },
  },
} as unknown as Anthropic;

const photo = { image: "aGVsbG8=", mediaType: "image/jpeg", fileName: "IMG_1.jpg", width: 10, height: 10 };
const single = { ...photo, categories: [{ section: "products", name: "Bags" }] };
const batch = (n: number) => ({ photos: Array.from({ length: n }, () => photo), categories: [{ section: "products", name: "Bags" }] });

async function call(app: ReturnType<typeof createApp>, method: string, path: string, headers: Record<string, string> = {}, body?: object) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const r = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  } finally {
    server.close();
  }
}

const active: Plan = { active: true, intro: false, periodStart: 1000, expires: Date.now() + 86_400_000, cancelled: false };
function subs(plans: Record<string, Plan>, introLimit = 0, monthlyLimit = 0, freeLimit = 0): SubscriptionOptions {
  return {
    freeLimit,
    plans: { plan: async (id) => plans[id] ?? { active: false, intro: false, periodStart: 0, expires: null, cancelled: false } },
    usage: memoryUsage(),
    introLimit,
    monthlyLimit,
  };
}
const user = (id: string) => ({ "x-organizeit-user": id });

describe("subscriptions", () => {
  it("turns away a phone that isn't subscribed, and sorts for one that is", async () => {
    const app = createApp(client, { passcode: "s3cret", subscriptions: subs({ "subscriber-1": active }) });
    const none = await call(app, "POST", "/api/classify", user("someone-else"), single);
    expect(none.status).toBe(402);
    expect(none.body.reason).toBe("subscribe");
    expect((await call(app, "POST", "/api/classify", {}, single)).status).toBe(402);
    expect((await call(app, "POST", "/api/classify", user("subscriber-1"), single)).status).toBe(200);
  });

  it("sorts the first photos on each phone free, then asks for a subscription", async () => {
    const app = createApp(client, { subscriptions: subs({}, 0, 0, 8) });
    expect((await call(app, "POST", "/api/classify-batch", user("new-phone-1"), batch(6))).status).toBe(200);
    const over = await call(app, "POST", "/api/classify-batch", user("new-phone-1"), batch(6));
    expect(over.status).toBe(402);
    expect(over.body).toMatchObject({ reason: "subscribe", error: "That's your 8 free photos. Subscribe to sort the rest." });
    expect((await call(app, "POST", "/api/classify-batch", user("new-phone-1"), batch(2))).status).toBe(200);
    expect((await call(app, "GET", "/api/subscription", user("new-phone-1"))).body).toMatchObject({ active: false, freeUsed: 8, freeLimit: 8 });
    // A different phone has its own free photos, up to a ceiling per network per day.
    expect((await call(app, "POST", "/api/classify-batch", user("new-phone-2"), batch(8))).status).toBe(200);
  });

  it("accepts only the exact passcode, and stops guessing after 10 wrong tries", async () => {
    const app = createApp(client, { passcode: "1100", subscriptions: subs({}) });
    expect((await call(app, "POST", "/api/unlock", { "x-organizeit-passcode": "1101" })).status).toBe(401);
    expect((await call(app, "POST", "/api/classify", { "x-organizeit-passcode": "a", ...user("guesser-1") }, single)).status).toBe(402);
    for (let i = 0; i < 8; i++) await call(app, "POST", "/api/unlock", { "x-organizeit-passcode": String(2000 + i) });
    const blocked = await call(app, "POST", "/api/unlock", { "x-organizeit-passcode": "1100" });
    expect(blocked.status).toBe(429);
    expect((await call(app, "POST", "/api/classify", { "x-organizeit-passcode": "1100" }, single)).status).toBe(429);
  });

  it("still lets the passcode sort without a subscription", async () => {
    const app = createApp(client, { passcode: "s3cret", subscriptions: subs({}) });
    expect((await call(app, "POST", "/api/classify", { "x-organizeit-passcode": "s3cret" }, single)).status).toBe(200);
  });

  it("caps the discounted first month, counting every photo in a batch", async () => {
    const app = createApp(client, { subscriptions: subs({ "trial-user": { ...active, intro: true } }, 10, 0) });
    expect((await call(app, "POST", "/api/classify-batch", user("trial-user"), batch(6))).status).toBe(200);
    const over = await call(app, "POST", "/api/classify-batch", user("trial-user"), batch(6));
    expect(over.status).toBe(402);
    expect(over.body.reason).toBe("limit");
    expect(over.body.error).toMatch(/first month includes 10 photos/);
    expect((await call(app, "POST", "/api/classify-batch", user("trial-user"), batch(4))).status).toBe(200);
    const status = await call(app, "GET", "/api/subscription", user("trial-user"));
    expect(status.body).toMatchObject({ active: true, intro: true, used: 10, limit: 10 });
  });

  it("gives each billing period a fresh allowance", async () => {
    const plans = { renewing: { ...active, periodStart: 1 } };
    const app = createApp(client, { subscriptions: subs(plans, 0, 2) });
    expect((await call(app, "POST", "/api/classify-batch", user("renewing"), batch(2))).status).toBe(200);
    expect((await call(app, "POST", "/api/classify", user("renewing"), single)).status).toBe(402);
    plans.renewing = { ...active, periodStart: 2 };
    expect((await call(app, "POST", "/api/classify", user("renewing"), single)).status).toBe(200);
  });

  it("reports subscriptions in the health check", async () => {
    expect((await call(createApp(client, { subscriptions: subs({}) }), "GET", "/api/health")).body.subscriptions).toBe(true);
    expect((await call(createApp(client), "GET", "/api/health")).body.subscriptions).toBe(false);
  });

  it("asks for a fresh answer when the subscription check fails", async () => {
    const app = createApp(client, {
      subscriptions: { ...subs({}), plans: { plan: async () => { throw new Error("down"); } } },
    });
    const r = await call(app, "POST", "/api/classify", user("anybody-1"), single);
    expect(r.status).toBe(502);
  });
});

describe("reading RevenueCat", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const subscriber = (periodType: string, expires = "2026-12-01T00:00:00Z") => ({
    entitlements: { organizeit_pro: { expires_date: expires, product_identifier: "monthly", purchase_date: "2026-11-01T00:00:00Z" } },
    subscriptions: { monthly: { period_type: periodType, purchase_date: "2026-11-01T00:00:00Z", expires_date: expires } },
  });

  it("tells the $2 first month from a full-price month", () => {
    expect(planFrom(subscriber("intro"), "organizeit_pro", now)).toMatchObject({ active: true, intro: true, periodStart: Date.parse("2026-11-01T00:00:00Z") });
    expect(planFrom(subscriber("normal"), "organizeit_pro", now)).toMatchObject({ active: true, intro: false });
  });

  it("treats an expired or missing entitlement as not subscribed", () => {
    expect(planFrom(subscriber("normal", "2026-11-05T00:00:00Z"), "organizeit_pro", now).active).toBe(false);
    expect(planFrom({}, "organizeit_pro", now).active).toBe(false);
    expect(planFrom(subscriber("normal"), "other", now).active).toBe(false);
  });

  it("calls the REST API with the secret key and remembers the answer", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
      return new Response(JSON.stringify({ subscriber: subscriber("normal", "2099-01-01T00:00:00Z") }));
    }) as unknown as typeof fetch;
    const plans = cached(revenueCat("sk_test", "organizeit_pro", fakeFetch));
    expect((await plans.plan("$RCAnonymousID:abc")).active).toBe(true);
    await plans.plan("$RCAnonymousID:abc");
    expect(seen).toEqual(["https://api.revenuecat.com/v1/subscribers/%24RCAnonymousID%3Aabc Bearer sk_test"]);
    plans.forget("$RCAnonymousID:abc");
    await plans.plan("$RCAnonymousID:abc");
    expect(seen).toHaveLength(2);
  });
});
