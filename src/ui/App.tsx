import { useEffect, useMemo, useState } from "react";
import { formatBytes, usageByCategory, usageBySection, type CategoryUsage } from "../core/storage";
import { SECTIONS, type Photo } from "../core/types";
import { browserPhotoSource, filesToPicked } from "../lib/photoSource";
import { SORT_LIMIT, useLibrary, type Library } from "../lib/useLibrary";
import { CategoryView } from "./CategoryView";
import { MoveDialog } from "./MoveDialog";
import { Thumb } from "./Thumb";

type View = { kind: "overview" } | { kind: "category"; id: string };

export function App() {
  const lib = useLibrary();
  const [view, setView] = useState<View>({ kind: "overview" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const usage = useMemo(() => usageByCategory(lib.categories, lib.photos), [lib.categories, lib.photos]);
  const category = view.kind === "category" ? lib.categories.find((c) => c.id === view.id) : undefined;

  // A category the AI created disappears once emptied; fall back to the overview.
  useEffect(() => {
    if (view.kind === "category" && lib.ready && !category) setView({ kind: "overview" });
  }, [view, category, lib.ready]);

  const add = async (folder = false) => lib.importPhotos(await browserPhotoSource({ folder }).pick());
  const open = (v: View) => {
    setView(v);
    setMenuOpen(false);
    window.scrollTo(0, 0);
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
            <button className="primary" onClick={() => add()}>Add photos</button>
          </>
        )}
      </header>

      <div className="layout">
        <nav className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Categories">
          <button className={`nav-item ${view.kind === "overview" ? "active" : ""}`} onClick={() => open({ kind: "overview" })}>
            Overview
          </button>
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

        <main>
          {!lib.ready || (lib.native && lib.permission === null) ? (
            <p className="muted">Loading your library…</p>
          ) : lib.native && lib.permission !== "granted" && lib.permission !== "limited" ? (
            <ConnectLibrary lib={lib} />
          ) : category ? (
            <CategoryView lib={lib} category={category} onGone={() => open({ kind: "overview" })} />
          ) : (
            <Overview lib={lib} usage={usage} onOpen={(id) => open({ kind: "category", id })} onAdd={add} />
          )}
        </main>
      </div>
      {dragging && <div className="drop-hint">Drop photos to sort them</div>}
    </div>
  );
}

function Overview({ lib, usage, onOpen, onAdd }: { lib: Library; usage: CategoryUsage[]; onOpen: (id: string) => void; onAdd: (folder?: boolean) => void }) {
  const sections = usageBySection(usage);
  const total = usage.reduce((n, u) => n + u.bytes, 0);
  const used = usage.filter((u) => u.count > 0);
  const biggest = used[0]?.bytes ?? 1;

  return (
    <div className="overview">
      <QueuePanel lib={lib} />

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

function QueuePanel({ lib }: { lib: Library }) {
  const pending = lib.photos.filter((p) => p.status === "queued" || p.status === "classifying");
  const failed = lib.photos.filter((p) => p.status === "error");
  const [fixing, setFixing] = useState<Photo[] | null>(null);
  if (!pending.length && !failed.length && lib.ai !== false && !lib.locked && !lib.scan) return null;

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
      {lib.locked && lib.ai !== false && <PasscodeForm lib={lib} />}
      {lib.ai === false && (
        <p className="error banner">
          AI sorting isn't connected. Start the server with an ANTHROPIC_API_KEY to sort photos; anything you add waits here until then.
        </p>
      )}
      {pending.length > 0 && (
        <div className="queue-row">
          <span className={lib.ai && !lib.locked ? "spinner" : ""} aria-hidden />
          <strong>Sorting {pending.length.toLocaleString()} photo{pending.length === 1 ? "" : "s"}…</strong>
        </div>
      )}
      {failed.length > 0 && (
        <div className="queue-failed">
          <p>
            <strong>{failed.length} couldn't be sorted automatically.</strong> Retry, or pick their categories yourself.
          </p>
          <ul className="mini-grid">
            {failed.slice(0, 12).map((p) => (
              <li key={p.id} title={p.error}>
                <Thumb photo={p} alt={p.fileName} />
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={() => lib.retry(failed.map((p) => p.id))}>Retry all</button>
            <button onClick={() => setFixing(failed)}>Choose category</button>
          </div>
        </div>
      )}
      {fixing && (
        <MoveDialog
          count={fixing.length}
          categories={lib.categories}
          defaultSection="products"
          onClose={() => setFixing(null)}
          onMove={async (target) => {
            await lib.move(fixing.map((p) => p.id), target);
            setFixing(null);
          }}
        />
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
