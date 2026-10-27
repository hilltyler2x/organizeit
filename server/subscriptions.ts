// Paid subscriptions. People subscribe in the iOS/Android app through the App Store or Google
// Play; RevenueCat (revenuecat.com) checks those receipts and is what this server asks whether
// someone is subscribed. The app sends the RevenueCat user id with every sorting request.
//
// Each billing period gets its own sorting allowance, so a $2 first month can't run up more AI
// cost than it brings in. Counts live in Postgres when DATABASE_URL is set; without it they are
// kept in memory, which forgets them whenever the server restarts.

export type Plan = {
  active: boolean;
  /** In the discounted first period (the $2 month). */
  intro: boolean;
  /** When the current billing period started (ms). Allowances reset when it changes. */
  periodStart: number;
  /** When the subscription runs out unless renewed (ms), or null for never. */
  expires: number | null;
  /** The person turned off auto-renew; it still works until `expires`. */
  cancelled: boolean;
};

const NONE: Plan = { active: false, intro: false, periodStart: 0, expires: null, cancelled: false };

export interface PlanSource {
  plan(userId: string): Promise<Plan>;
}

/** Thrown when RevenueCat can't be asked; the request fails with a retryable error. */
export class PlanUnavailable extends Error {}

type RcEntitlement = { expires_date: string | null; product_identifier: string; purchase_date: string };
type RcSubscription = {
  period_type?: string;
  purchase_date?: string;
  expires_date?: string | null;
  unsubscribe_detected_at?: string | null;
};

/** Reads someone's subscription from RevenueCat's REST API with the project's secret key. */
export function revenueCat(secretKey: string, entitlement = "organizeit_pro", fetchImpl: typeof fetch = fetch): PlanSource {
  return {
    async plan(userId) {
      let r: Response;
      try {
        r = await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new PlanUnavailable("Couldn't check your subscription. Try again in a moment.");
      }
      if (r.status === 404) return NONE;
      if (!r.ok) {
        console.error(`RevenueCat answered ${r.status} for a subscription check.`);
        throw new PlanUnavailable("Couldn't check your subscription. Try again in a moment.");
      }
      const body = (await r.json()) as {
        subscriber?: { entitlements?: Record<string, RcEntitlement>; subscriptions?: Record<string, RcSubscription> };
      };
      return planFrom(body.subscriber, entitlement, Date.now());
    },
  };
}

export function planFrom(
  subscriber: { entitlements?: Record<string, RcEntitlement>; subscriptions?: Record<string, RcSubscription> } | undefined,
  entitlement: string,
  now: number,
): Plan {
  const ent = subscriber?.entitlements?.[entitlement];
  if (!ent) return NONE;
  const expires = ent.expires_date ? Date.parse(ent.expires_date) : null;
  if (expires !== null && expires <= now) return NONE;
  const sub = subscriber?.subscriptions?.[ent.product_identifier];
  return {
    active: true,
    intro: sub?.period_type === "intro" || sub?.period_type === "trial",
    periodStart: Date.parse(sub?.purchase_date ?? ent.purchase_date) || 0,
    expires,
    cancelled: Boolean(sub?.unsubscribe_detected_at),
  };
}

/**
 * Remembers answers for a few minutes so a phone sorting thousands of photos doesn't ask
 * RevenueCat on every request. Someone not (yet) subscribed is re-checked sooner, so a new
 * purchase unlocks sorting quickly.
 */
export function cached(source: PlanSource, ttlMs = 5 * 60_000, inactiveTtlMs = 30_000): PlanSource & { forget(userId: string): void } {
  const memo = new Map<string, { at: number; active: boolean; plan: Promise<Plan> }>();
  return {
    plan(userId) {
      const now = Date.now();
      const hit = memo.get(userId);
      if (hit && now - hit.at < (hit.active ? ttlMs : inactiveTtlMs)) return hit.plan;
      if (memo.size > 50_000) {
        for (const [k, v] of memo) if (now - v.at >= ttlMs) memo.delete(k);
      }
      // Shared while it is being asked, so a burst of requests asks RevenueCat once.
      const entry = { at: now, active: true, plan: source.plan(userId) };
      memo.set(userId, entry);
      entry.plan.then((p) => (entry.active = p.active), () => memo.get(userId) === entry && memo.delete(userId));
      return entry.plan;
    },
    forget(userId) {
      memo.delete(userId);
    },
  };
}

/** Photos sorted per person per billing period. */
export interface UsageStore {
  /** Adds `n` unless that would pass `limit`. Returns the new total, or null if it would. */
  add(key: string, n: number, limit: number): Promise<number | null>;
  used(key: string): Promise<number>;
}

export function memoryUsage(): UsageStore {
  const counts = new Map<string, number>();
  return {
    async add(key, n, limit) {
      const next = (counts.get(key) ?? 0) + n;
      if (next > limit) return null;
      counts.set(key, next);
      return next;
    },
    async used(key) {
      return counts.get(key) ?? 0;
    },
  };
}

/** Counts kept in Postgres, so they survive restarts and are shared by every server instance. */
export async function postgresUsage(url: string): Promise<UsageStore> {
  const { default: pg } = await import("pg");
  const setUp = async (ssl: boolean) => {
    const pool = new pg.Pool({ connectionString: url, max: 5, ssl: ssl ? { rejectUnauthorized: false } : undefined });
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS sort_usage (
        key text PRIMARY KEY,
        count integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      return pool;
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw err;
    }
  };
  // Encrypted when the database offers it (external URLs require it; Render's internal ones
  // may not), plain otherwise.
  const pool = await setUp(true).catch(() => setUp(false));
  return {
    async add(key, n, limit) {
      if (n > limit) return null;
      // One statement, so two requests at once can't both squeeze under the limit.
      const r = await pool.query<{ count: number }>(
        `INSERT INTO sort_usage (key, count) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET count = sort_usage.count + $2, updated_at = now()
           WHERE sort_usage.count + $2 <= $3
         RETURNING count`,
        [key, n, limit],
      );
      return r.rows[0]?.count ?? null;
    },
    async used(key) {
      const r = await pool.query<{ count: number }>("SELECT count FROM sort_usage WHERE key = $1", [key]);
      return r.rows[0]?.count ?? 0;
    },
  };
}

export type SubscriptionOptions = {
  plans: PlanSource & { forget?(userId: string): void };
  usage: UsageStore;
  /** Photos a phone can sort free, before subscribing. 0 = none. */
  freeLimit: number;
  /** Photos a person can sort in the discounted first month. 0 = no limit. */
  introLimit: number;
  /** Photos a person can sort in each full-price month. 0 = no limit. */
  monthlyLimit: number;
};

export const freeKey = (userId: string) => `${userId}:free`;
export const usageKey = (userId: string, plan: Plan) => `${userId}:${plan.periodStart}`;
export const limitFor = (options: SubscriptionOptions, plan: Plan) => (plan.intro ? options.introLimit : options.monthlyLimit);

/** RevenueCat ids: our own, or its anonymous "$RCAnonymousID:<hex>". */
export const validUserId = (id: string) => /^[\w$:.@-]{8,128}$/.test(id);
