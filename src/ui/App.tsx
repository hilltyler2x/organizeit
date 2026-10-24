import { useEffect, useMemo, useRef, useState } from "react";
import { needsPerson } from "../core/library";
import { formatBytes, usageByCategory, usageBySection, type CategoryUsage } from "../core/storage";
import { SECTIONS } from "../core/types";
import { browserPhotoSource, filesToPicked } from "../lib/photoSource";
import { SORT_LIMIT, useLibrary, type Library } from "../lib/useLibrary";
import { CategoryView } from "./CategoryView";
import { BackLayer, useBack } from "./back";
import { ReviewView } from "./ReviewView";
import { Thumb } from "./Thumb";

type View = { kind: "overview" } | { kind: "review" } | { kind: "category"; id: string };

export function App() {
  const lib = useLibrary();
  const [view, setView] = useState<View>({ kind: "overview" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const usage = useMemo(() => usageByCategory(lib.categories, lib.photos), [lib.categories, lib.photos]);
  const category = view.kind === "category" ? lib.categories.find((c) => c.id === view.id) : undefined;
  const toReview = useMemo(() => needsPerson(lib.photos).length, [lib.photos]);

  // A category the AI created disappears once emptied; fall back to the overview.
  useEffect(() => {
    if (view.kind === "category" && lib.ready && !category) setView({ kind: "overview" });
  }, [view, category, lib.ready]);

  const add = async (folder = false) => lib.importPhotos(await browserPhotoSource({ folder }).pick());
  const open = (v: View) => {
    setView(v);
    setMenuOpen(false);
    mainRef.current?.scrollTo(0, 0);
  };
  useBack(menuOpen, () => setMenuOpen(false), BackLayer.menu);
  useBack(view.kind !== "overview", () => open({ kind: "overview" }), BackLayer.page);

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
            <button className="primary" onClick={() => add()}>Add photos</button>
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
                    <span>{u.category.name}{!u.category.seeded && <span className="new-dot" title="Created by OrganizeIt" />}</span>
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
          ) : category ? (
            <CategoryView lib={lib} category={category} onGone={() => open({ kind: "overview" })} />
          ) : (
            <Overview lib={lib} usage={usage} onOpen={(id) => open({ kind: "category", id })} onReview={() => open({ kind: "review" })} onAdd={add} />
          )}
        </main>
      </div>
      {dragging && <div className="drop-hint">Drop photos to sort them</div>}
    </div>
  );
}

function Overview({ lib, usage, onOpen, onReview, onAdd }: { lib: Library; usage: CategoryUsage[]; onOpen: (id: string) => void; onReview: () => void; onAdd: (folder?: boolean) => void }) {
  const sections = usageBySection(usage);
  const total = usage.reduce((n, u) => n + u.bytes, 0);
  const used = usage.filter((u) => u.count > 0);
  const biggest = used[0]?.bytes ?? 1;

  return (
    <div className="overview">
      <QueuePanel lib={lib} onReview={onReview} />

      {lib.native && SORT_LIMIT > 0 && (
        <p className="muted small">Test mode: sorting your newest {SORT_LIMIT.toLocaleString()} photos.</p>
      )}
      {lib.native && lib.permission === "limited" && (
        <div className="queue-row limited">
          <span>OrganizeIt can only see the photos you selected. Allow full access to sort your whole library.</span>
          <button onClick={lib.openSettings}>Open Settings</button>
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
            <button className="primary big" onClick={() => onAdd()}>Add photos</button>
            <button className="big hide-small" onClick={() => onAdd(true)}>Add a folder</button>
          </div>
          <p className="muted small">On iPhone or Android, "Add photos" opens your Photos library. Photos stay on this device; only a small preview is sent for sorting.</p>
        </div>
      ) : (
        <>
          <div className="stat-row">
            {SECTIONS.map((s) => (
              <div key={s.id} className="stat">
                <p className="eyebrow">{s.label}</p>
                <p className="stat-value">{formatBytes(sections[s.id].bytes)}</p>
                <p className="muted">{sections[s.id].count} photo{sections[s.id].count === 1 ? "" : "s"}</p>
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
  if (!pending.length && !waiting.length && lib.server === "ok" && !lib.locked && !lib.scan) return null;

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
          ? "You can close the app; sorting keeps going in the background."
          : "Sorting pauses about 30 seconds after you close the app (iOS 26 lets it keep going), and catches up when iOS gives it time."}
      {b.last && ` Last: ${b.last}${when ? ` (${when})` : ""}`}
    </p>
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
