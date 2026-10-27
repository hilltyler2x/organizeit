import { useEffect, useMemo, useRef, useState } from "react";
import { duplicateTotals, findDuplicates } from "../core/duplicates";
import { categoriesWithNew, needsPerson } from "../core/library";
import { countLabel, formatBytes, usageByCategory, usageBySection, type CategoryUsage } from "../core/storage";
import { SECTIONS } from "../core/types";
import { API } from "../lib/api";
import { browserPhotoSource, filesToPicked } from "../lib/photoSource";
import { buy, canBuy, monthlyOffer, restore, type Offer } from "../lib/purchases";
import { SORT_LIMIT, useLibrary, type Library } from "../lib/useLibrary";
import { CategoryView } from "./CategoryView";
import { DuplicatesView } from "./DuplicatesView";
import { Toaster } from "./PhotoMenu";
import { ReviewView } from "./ReviewView";
import { Thumb } from "./Thumb";

type View = { kind: "overview" } | { kind: "review" } | { kind: "duplicates" } | { kind: "category"; id: string };

export function App() {
  const lib = useLibrary();
  const [view, setView] = useState<View>({ kind: "overview" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const usage = useMemo(() => usageByCategory(lib.categories, lib.photos), [lib.categories, lib.photos]);
  const category = view.kind === "category" ? lib.categories.find((c) => c.id === view.id) : undefined;
  const toReview = useMemo(() => needsPerson(lib.photos).length, [lib.photos]);
  const duplicates = useMemo(() => duplicateTotals(findDuplicates(lib.photos)), [lib.photos]);
  const withNew = useMemo(() => categoriesWithNew({ photos: lib.photos, categories: lib.categories }), [lib.photos, lib.categories]);

  // A category the AI created disappears once emptied; fall back to the overview.
  useEffect(() => {
    if (view.kind === "category" && lib.ready && !category) setView({ kind: "overview" });
  }, [view, category, lib.ready]);

  // Opening a category clears its dot. It stays clear while open, and comes back only when
  // the AI files something new there after the person has left it.
  const markSeen = lib.markSeen;
  useEffect(() => {
    if (category && withNew.has(category.id)) markSeen(category.id);
  }, [category, withNew, markSeen]);

  const add = async (folder = false) => lib.importPhotos(await browserPhotoSource({ folder }).pick());
  const open = (v: View) => {
    setView(v);
    setMenuOpen(false);
    mainRef.current?.scrollTo(0, 0);
  };

  return (
    <div
      className={`app ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!lib.native) setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!lib.native) lib.importPhotos(filesToPicked(e.dataTransfer.files));
      }}
    >
      <header className="topbar">
        <button className="menu-toggle" aria-label="Categories" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        <button className="brand" onClick={() => open({ kind: "overview" })}>
          <img className="logo" src="/icon.svg" alt="" /> OrganizeIt
        </button>
        <span className="spacer" />
        {!lib.native && (
          <>
            <button className="hide-small" onClick={() => add(true)}>Add folder</button>
            <button className="primary" onClick={() => add()}>Add photos &amp; videos</button>
          </>
        )}
      </header>

      <div className="layout">
        <nav className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Categories">
          <button className={`nav-item ${view.kind === "overview" ? "active" : ""}`} onClick={() => open({ kind: "overview" })}>
            Overview
          </button>
          {(toReview > 0 || view.kind === "review") && (
            <button className={`nav-item review-item ${view.kind === "review" ? "active" : ""}`} onClick={() => open({ kind: "review" })}>
              <span>To review</span>
              <span className="count">{toReview || ""}</span>
            </button>
          )}
          {(duplicates.extras > 0 || view.kind === "duplicates") && (
            <button className={`nav-item review-item ${view.kind === "duplicates" ? "active" : ""}`} onClick={() => open({ kind: "duplicates" })}>
              <span>Duplicates</span>
              <span className="count">{duplicates.extras || ""}</span>
            </button>
          )}
          {SECTIONS.map((s) => {
            const items = usage.filter((u) => u.category.section === s.id);
            if (items.length === 0) return null;
            return (
              <div key={s.id} className="nav-section">
                <h3>{s.label}</h3>
                {items.map((u) => (
                  <button
                    key={u.category.id}
                    className={`nav-item ${category?.id === u.category.id ? "active" : ""} ${u.count === 0 ? "dim" : ""}`}
                    onClick={() => open({ kind: "category", id: u.category.id })}
                  >
                    <span>{u.category.name}{withNew.has(u.category.id) && <span className="new-dot" title="New photos" />}</span>
                    <span className="count">{u.count || ""}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        {menuOpen && <button className="scrim" aria-label="Close categories" onClick={() => setMenuOpen(false)} />}

        <main ref={mainRef}>
          {!lib.ready || (lib.native && lib.permission === null) ? (
            <p className="muted">Loading your library…</p>
          ) : lib.native && lib.permission !== "granted" && lib.permission !== "limited" ? (
            <ConnectLibrary lib={lib} />
          ) : view.kind === "review" ? (
            <ReviewView lib={lib} onDone={() => open({ kind: "overview" })} />
          ) : view.kind === "duplicates" ? (
            <DuplicatesView lib={lib} onDone={() => open({ kind: "overview" })} />
          ) : category ? (
            <CategoryView lib={lib} category={category} onGone={() => open({ kind: "overview" })} />
          ) : (
            <Overview
              lib={lib}
              usage={usage}
              duplicates={duplicates}
              onOpen={(id) => open({ kind: "category", id })}
              onReview={() => open({ kind: "review" })}
              onDuplicates={() => open({ kind: "duplicates" })}
              onAdd={add}
            />
          )}
        </main>
      </div>
      {dragging && <div className="drop-hint">Drop photos to sort them</div>}
      <Toaster />
    </div>
  );
}

function Overview({ lib, usage, duplicates, onOpen, onReview, onDuplicates, onAdd }: {
  lib: Library;
  usage: CategoryUsage[];
  duplicates: { extras: number; bytes: number };
  onOpen: (id: string) => void;
  onReview: () => void;
  onDuplicates: () => void;
  onAdd: (folder?: boolean) => void;
}) {
  const sections = usageBySection(usage);
  const total = usage.reduce((n, u) => n + u.bytes, 0);
  const used = usage.filter((u) => u.count > 0);
  const biggest = used[0]?.bytes ?? 1;

  return (
    <div className="overview">
      <QueuePanel lib={lib} onReview={onReview} />
      {duplicates.extras > 0 && (
        <div className="queue-row duplicates-notice">
          <span>
            <strong>You have {duplicates.extras.toLocaleString()} duplicate photo{duplicates.extras === 1 ? "" : "s"}</strong>
            <span className="muted small"> using {formatBytes(duplicates.bytes)}. Review them to keep the best copy and free up space.</span>
          </span>
          <button className="primary" onClick={onDuplicates}>Review duplicates</button>
        </div>
      )}

      {lib.native && SORT_LIMIT > 0 && (
        <p className="muted small">Test mode: sorting your newest {SORT_LIMIT.toLocaleString()} photos.</p>
      )}
      {lib.native && lib.permission === "limited" && (
        <div className="queue-row limited">
          <span>
            OrganizeIt can only see the photos you picked, not your whole library. Allow full access so every photo gets sorted.
            {lib.canMakeAlbums && " In Settings, tap Photos, then Full Access."}
          </span>
          <button className="primary" onClick={lib.allowFullAccess}>Allow full access</button>
        </div>
      )}
      {lib.photos.length === 0 && lib.native ? (
        <div className="welcome">
          <h1>{lib.scan ? "Reading your library…" : "No photos yet"}</h1>
          <p className="muted">New photos are sorted automatically each time you open OrganizeIt.</p>
        </div>
      ) : lib.photos.length === 0 ? (
        <div className="welcome">
          <h1>Sort your camera roll</h1>
          <p>
            Add photos from your library. OrganizeIt pulls business expense screenshots into their own section and sorts product
            photos by exact item type. Anything new gets its own category, never a catch-all.
          </p>
          <div className="row">
            <button className="primary big" onClick={() => onAdd()}>Add photos &amp; videos</button>
            <button className="big hide-small" onClick={() => onAdd(true)}>Add a folder</button>
          </div>
          <p className="muted small">On iPhone or Android, "Add photos &amp; videos" opens your Photos library. Everything stays on this device; only a small preview is sent for sorting (a few still frames for a video).</p>
        </div>
      ) : (
        <>
          <div className="stat-row">
            {SECTIONS.map((s) => (
              <div key={s.id} className="stat">
                <p className="eyebrow">{s.label}</p>
                <p className="stat-value">{formatBytes(sections[s.id].bytes)}</p>
                <p className="muted">{countLabel(sections[s.id].count - sections[s.id].videos, sections[s.id].videos)}</p>
              </div>
            ))}
          </div>

          <h2>Storage by category</h2>
          <p className="muted">{formatBytes(total)} across {used.length} categories, largest first.</p>
          <ul className="usage-list">
            {used.map((u) => (
              <li key={u.category.id}>
                <button onClick={() => onOpen(u.category.id)}>
                  <span className="usage-name">
                    {u.category.name}
                    <span className="muted small"> {SECTIONS.find((s) => s.id === u.category.section)!.label}</span>
                  </span>
                  <span className="usage-bar" aria-hidden>
                    <span className={`fill ${u.category.section}`} style={{ width: `${Math.max(2, (u.bytes / biggest) * 100)}%` }} />
                  </span>
                  <span className="usage-num">
                    {formatBytes(u.bytes)} <span className="muted small">· {u.count}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ConnectLibrary({ lib }: { lib: Library }) {
  const denied = lib.permission === "denied";
  return (
    <div className="welcome connect">
      <img className="connect-icon" src="/icon.svg" alt="" />
      <h1>{denied ? "Photos access is off" : "Let OrganizeIt sort your photos"}</h1>
      <p>
        OrganizeIt looks through your photo library, pulls receipts, invoices and order confirmations into Business Expenses,
        and sorts product photos by exact item type. It keeps checking for new photos every time you open it.
      </p>
      {denied ? (
        <>
          <button className="primary big" onClick={lib.openSettings}>Open Settings</button>
          <p className="muted small">In Settings, tap Photos and choose Full Access (iPhone) or Allow all (Android).</p>
        </>
      ) : (
        <>
          <button className="primary big" onClick={lib.connectLibrary}>Allow access to Photos</button>
          <p className="muted small">Your photos stay on your phone. Only a small preview of each is sent to be sorted.</p>
        </>
      )}
    </div>
  );
}

function QueuePanel({ lib, onReview }: { lib: Library; onReview: () => void }) {
  const pending = lib.photos.filter((p) => p.status === "queued" || p.status === "classifying");
  const waiting = needsPerson(lib.photos);
  const failed = waiting.filter((p) => p.status === "error");
  const connecting = lib.server === "checking" || lib.server === "offline";
  if (!pending.length && !waiting.length && lib.server === "ok" && !lib.locked && !lib.scan && !lib.paywall) return null;

  return (
    <div className="queue">
      {lib.scan && (
        <div className="queue-row">
          <span className="spinner" aria-hidden />
          <strong>
            Reading your library…{lib.scan.total ? ` ${lib.scan.done.toLocaleString()} of ${lib.scan.total.toLocaleString()}` : ""}
          </strong>
        </div>
      )}
      {connecting && (pending.length > 0 || lib.server === "offline") && (
        <div className="queue-row">
          <span className="spinner" aria-hidden />
          <span>
            <strong>Connecting to the sorting server…</strong>
            <span className="muted small"> After a quiet spell it can take a minute to wake up.</span>
          </span>
        </div>
      )}
      {lib.locked && lib.server === "ok" && <PasscodeForm lib={lib} />}
      {lib.paywall && lib.server === "ok" && <Paywall lib={lib} />}
      {lib.server === "no-ai" && (
        <p className="error banner">
          {lib.aiProblem ?? "The sorting server doesn't have an Anthropic API key."} Add a working ANTHROPIC_API_KEY to the
          server's environment (on Render: Environment), then reopen OrganizeIt. Photos wait here until then.
        </p>
      )}
      {pending.length > 0 && (
        <div className="queue-row sorting">
          <span className={lib.server === "ok" && !lib.locked ? "spinner" : ""} aria-hidden />
          <span>
            <strong>Sorting {pending.length.toLocaleString()} photo{pending.length === 1 ? "" : "s"}…</strong>
            {lib.sortRate && <span className="muted small"> {timeLeft(pending.length / lib.sortRate)}</span>}
            <PlanNote lib={lib} />
          </span>
          {lib.sortedThisRun > 0 && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round((100 * lib.sortedThisRun) / (lib.sortedThisRun + pending.length))}>
              <span style={{ width: `${(100 * lib.sortedThisRun) / (lib.sortedThisRun + pending.length)}%` }} />
            </div>
          )}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="queue-failed">
          <p>
            <strong>{waiting.length.toLocaleString()} photo{waiting.length === 1 ? "" : "s"} need{waiting.length === 1 ? "s" : ""} your help.</strong>{" "}
            OrganizeIt wasn't sure where {waiting.length === 1 ? "it goes" : "they go"}. Your answers teach it for next time.
          </p>
          <ul className="mini-grid">
            {waiting.slice(0, 12).map((p) => (
              <li key={p.id} title={p.error ?? p.label}>
                <Thumb photo={p} alt={p.label ?? p.fileName} />
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="primary" onClick={onReview}>Review</button>
            {failed.length > 0 && <button onClick={() => lib.retry(failed.map((p) => p.id))}>Retry {failed.length} failed</button>}
          </div>
        </div>
      )}
      {pending.length > 0 && <BackgroundNote lib={lib} />}
    </div>
  );
}

function timeLeft(seconds: number): string {
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 6) / 10;
  return `About ${hours} hour${hours === 1 ? "" : "s"} left`;
}

/** Whether sorting will carry on once the app is closed, and what it last did. */
function BackgroundNote({ lib }: { lib: Library }) {
  const b = lib.background;
  if (!lib.native || !b) return null;
  const when = b.lastAt ? new Date(b.lastAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <p className="muted small">
      {b.backgroundRefresh !== "on"
        ? /android/i.test(navigator.userAgent)
          ? "Sorting stops when you close the app because Android's battery settings restrict OrganizeIt. Set its battery use to Unrestricted in Settings → Apps → OrganizeIt."
          : "Sorting stops when you close the app because Background App Refresh is off for OrganizeIt. Turn it on in Settings → General → Background App Refresh."
        : b.keepsGoingAfterClose
          ? "You can close the app; sorting keeps going in the background (up to 100 photos on battery, the rest while charging)."
          : "Sorting pauses about 30 seconds after you close the app (iOS 26 lets it keep going), and catches up when iOS gives it time."}
      {b.last && ` Last: ${b.last}${when ? ` (${when})` : ""}`}
    </p>
  );
}

/** How much of the free preview or the first month is used, while sorting. */
function PlanNote({ lib }: { lib: Library }) {
  const p = lib.plan;
  if (!lib.subscriptions || !p || lib.paywall) return null;
  if (!p.active && p.freeLimit > 0) {
    return <span className="muted small"> Free preview: {Math.min(p.freeUsed, p.freeLimit)} of {p.freeLimit} photos.</span>;
  }
  if (p.active && p.limit > 0) {
    return <span className="muted small"> {p.intro ? "First month" : "This month"}: {p.used.toLocaleString()} of {p.limit.toLocaleString()} photos.</span>;
  }
  return null;
}

/** Sorting is paused until the person subscribes (or, in the $2 month, until it renews). */
function Paywall({ lib }: { lib: Library }) {
  const reason = lib.paywall!.reason;
  const [offer, setOffer] = useState<Offer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "unavailable">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [usePasscode, setUsePasscode] = useState(false);
  const android = /android/i.test(navigator.userAgent);

  useEffect(() => {
    if (reason !== "subscribe") return;
    monthlyOffer().then(
      (o) => {
        setOffer(o);
        setState(o ? "ready" : "unavailable");
      },
      () => setState("unavailable"),
    );
  }, [reason]);

  // The store has taken payment; the server hears about it from RevenueCat within moments.
  const unlocked = async () => {
    for (let i = 0; i < 5; i++) {
      const p = await lib.refreshPlan(true);
      if (p?.active) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setProblem("Your purchase went through, but the server hasn't seen it yet. Close and reopen OrganizeIt in a minute.");
  };

  const run = async (action: () => Promise<boolean | void>) => {
    setState("busy");
    setProblem(null);
    try {
      if ((await action()) !== false) await unlocked();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The store couldn't complete that. Try again.");
    } finally {
      setState(offer ? "ready" : "unavailable");
    }
  };

  if (reason === "limit") {
    return (
      <div className="queue-row paywall">
        <strong>Sorting is paused for this month.</strong>
        <p className="muted small">{lib.paywall!.message}</p>
      </div>
    );
  }

  return (
    <div className="queue-row paywall">
      <strong>Keep OrganizeIt sorting</strong>
      <p className="muted small">{lib.paywall!.message}</p>
      {offer && (
        <p>
          {offer.introPrice ? (
            <>
              <strong>{offer.introPrice}</strong> for your first month, then {offer.price} a month.
            </>
          ) : (
            <>
              <strong>{offer.price}</strong> a month.
            </>
          )}{" "}
          New photos are sorted the moment you take them, and your whole library gets sorted.
        </p>
      )}
      {state === "unavailable" && (
        <p className="muted small">
          {canBuy ? "The store isn't answering right now. Try again in a moment." : "Subscriptions aren't available in this version of the app yet."}
        </p>
      )}
      {problem && <p className="error small">{problem}</p>}
      <div className="row">
        {offer && (
          <button className="primary" disabled={state === "busy"} onClick={() => run(() => buy(offer))}>
            {offer.introPrice ? `Start for ${offer.introPrice}` : "Subscribe"}
          </button>
        )}
        {canBuy && (
          <button disabled={state === "busy"} onClick={() => run(restore)}>Restore purchases</button>
        )}
      </div>
      {offer && (
        <p className="muted small fine-print">
          Paid through your {android ? "Google Play" : "Apple"} account. The subscription renews each month at {offer.price} until you
          cancel, which you can do any time in {android ? "Play Store → Payments & subscriptions → Subscriptions" : "Settings → your name → Subscriptions"},
          at least 24 hours before it renews.{" "}
          <a href={`${API}/terms.html`} target="_blank" rel="noreferrer">Terms</a> ·{" "}
          <a href={`${API}/privacy.html`} target="_blank" rel="noreferrer">Privacy</a>
        </p>
      )}
      {usePasscode ? (
        <PasscodeForm lib={lib} />
      ) : (
        <button className="link small" onClick={() => setUsePasscode(true)}>Have a passcode?</button>
      )}
    </div>
  );
}

function PasscodeForm({ lib }: { lib: Library }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong">("idle");
  return (
    <form
      className="queue-row passcode"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("checking");
        setState((await lib.unlock(code.trim()).catch(() => false)) ? "idle" : "wrong");
      }}
    >
      <label htmlFor="passcode">
        <strong>Enter your passcode to start sorting.</strong>
        <span className="muted small"> You only need to do this once on each device.</span>
      </label>
      <div className="row">
        <input id="passcode" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" />
        <button className="primary" type="submit" disabled={!code.trim() || state === "checking"}>Unlock</button>
      </div>
      {state === "wrong" && <p className="error small">That passcode didn't work.</p>}
    </form>
  );
}
