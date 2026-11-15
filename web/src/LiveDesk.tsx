import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeskItem, Screen } from "../../src/live/desk";
import type { historySummary } from "../../src/live/history";
import { humanAction, humanizeDecisions } from "../../src/demo/evidence";
import { readableExplanation } from "./timeline-utils";
import { breakdown, countdown, finalTiming, freshness, humanGateReason, humanNeed, humanScope, humanScreen, numberText, screenOrder, teaserText } from "./live-utils";
import type { LiveResponse } from "./live-utils";

type History = ReturnType<typeof historySummary>;
async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Live desk unavailable");
  return response.json() as Promise<T>;
}

function useLiveDesk(withHistory = false) {
  const [snapshot, setSnapshot] = useState<LiveResponse | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [receivedAt, setReceivedAt] = useState(0);
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (current.current) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const [live, past] = await Promise.allSettled([
        fetchJson<LiveResponse>("/api/live", controller.signal),
        withHistory ? fetchJson<History>("/api/live/history", controller.signal) : Promise.resolve(null),
      ]);
      if (current.current !== controller) return;
      if (live.status === "fulfilled") { setSnapshot(live.value); setReceivedAt(Date.now()); setError(false); }
      else setError(true);
      // A history failure must not retain counts that look freshly verified.
      setHistory(past.status === "fulfilled" ? past.value : null);
    } finally {
      window.clearTimeout(timeout);
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }, [withHistory]);
  useEffect(() => {
    if (!document.hidden) void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const visibility = () => {
      if (document.hidden) { current.current?.abort(); current.current = null; setBusy(false); }
      else void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visibility); current.current?.abort(); current.current = null; };
  }, [refresh]);
  return { snapshot, history, receivedAt, busy, error, refresh };
}

export function LiveTeaser() {
  const { snapshot, error, busy } = useLiveDesk();
  return <a className="live-teaser" href="/live"><span><span className="eyebrow">Live desk</span><br />{error ? "Live desk temporarily unavailable" : busy && !snapshot ? "Loading live proposals…" : teaserText(snapshot)}</span><span aria-hidden="true">↗</span></a>;
}
function Instant({ value }: { value: string | null | undefined }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>Not established</span>;
  return <time dateTime={value}>{new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC")}</time>;
}
function Game({ item }: { item: DeskItem }) {
  return item.game ? <><span>{item.game.score ?? "Score unavailable"}{item.game.period ? ` · ${humanizeDecisions(item.game.period)}` : ""}</span><small>{item.game.title ?? (item.game.ended ? "Feed marked final" : "Game completion unconfirmed")}</small></> : <span>Game feed unavailable</span>;
}
function ProposalLinks({ item }: { item: DeskItem }) {
  return <div className="desk-links"><a href={item.uma_url} target="_blank" rel="noreferrer">UMA oracle ↗</a>{item.polymarket_url && <a href={item.polymarket_url} target="_blank" rel="noreferrer">Polymarket ↗</a>}{item.receipt_id && <a href={`/api/receipts/${encodeURIComponent(item.receipt_id)}`} target="_blank" rel="noreferrer">Receipt ↗</a>}</div>;
}
function Needs({ item }: { item: DeskItem }) {
  const details = item.need_details?.length ? item.need_details.map((detail) => detail.text) : item.needs.map(humanNeed);
  return details.length ? <ul className="desk-needs">{details.map((text, index) => <li key={index}>{readableExplanation(humanizeDecisions(text))}</li>)}</ul> : <p>No further evidence needs recorded.</p>;
}
function FlaggedCard({ item, now }: { item: DeskItem; now: number }) {
  return <article className="panel desk-flag"><span className="desk-chip desk-early">Likely too early</span><h3>{item.title}</h3><p>Proposed outcome: <strong>{humanizeDecisions(item.proposed_outcome)}</strong></p>
    <dl><dt>Code + evidence</dt><dd>{readableExplanation(humanizeDecisions(humanGateReason(item.reason)))}</dd><dt>SERV rule reading</dt><dd>Also found the proposal premature; the gate returned Wait.</dd><dt>Game snapshot</dt><dd><Game item={item} /></dd><dt>Challenge window</dt><dd className="mono">{countdown(item.liveness_ends_utc, now)} left</dd><dt>Bond</dt><dd>{item.bond_usdc === null ? "USDC amount unavailable" : `${numberText(item.bond_usdc)} USDC`}</dd></dl>
    <ProposalLinks item={item} /><p className="desk-caution">Looks too early under the rules. Verify before acting; this is not a recommendation to dispute.</p>
  </article>;
}

function ScreenSummary({ items }: { items: DeskItem[] }) {
  const flagged = items.filter((item) => item.flag === "LIKELY_TOO_EARLY").length;
  const codeOnly = items.filter((item) => item.screen === "TOO_EARLY_BY_CODE" && item.flag !== "LIKELY_TOO_EARLY").length;
  const segments = [
    { label: "Likely too early", count: flagged, tone: "early", detail: "Code or event evidence and SERV agree it looks premature." },
    { label: "Inside feed lag", count: items.filter((i) => i.screen === "WITHIN_FEED_LAG").length, tone: "lag", detail: "Feed marked final within 30 minutes after the proposal; timing is inconclusive." },
    { label: "Confirmed on time", count: items.filter((i) => i.screen === "ON_TIME_BY_FEED").length, tone: "on-time", detail: "Evidence places the game finish or event before the proposal; SERV may still be unread." },
    { label: "Passed code cutoff", count: items.filter((i) => i.screen === "PASSES_CODE").length, tone: "code", detail: "The rules’ deterministic cutoff passed; this alone is not a Proceed action." },
    { label: "No deterministic key", count: items.filter((i) => i.screen === "NO_DETERMINISTIC_KEY").length, tone: "no-key", detail: "The available rules and evidence cannot establish a decisive time." },
    ...(codeOnly ? [{ label: "Code concern, unconfirmed", count: codeOnly, tone: "unconfirmed", detail: "A deterministic concern is present; SERV has not confirmed a likely-too-early flag." }] : []),
  ];
  return <section className="desk-screening panel" aria-labelledby="screening-title"><div className="section-title"><div><p className="eyebrow">Timing screen</p><h2 id="screening-title">What the evidence can say</h2></div><span className="small muted">Current challenge windows</span></div>
    <div className="desk-segments" role="img" aria-label={segments.map((s) => `${s.label}: ${s.count}`).join("; ")}>{segments.filter((s) => s.count > 0).map((s) => <span key={s.tone} className={`desk-${s.tone}`} style={{ flexGrow: s.count }} title={`${s.label}: ${s.count}`} />)}</div>
    <div className="desk-legend">{segments.map((s) => <div key={s.tone}><i className={`desk-${s.tone}`} aria-hidden="true" /><div><strong>{s.label} <span className="mono">{numberText(s.count)}</span></strong><p>{s.detail}</p></div></div>)}</div>
    <div className="desk-breakdown"><h3>No deterministic key · what is missing</h3><dl>{breakdown(items).map((group) => <div key={group.key}><dt>{group.label}</dt><dd className="mono">{numberText(group.count)}</dd></div>)}</dl></div>
  </section>;
}

function ProposalTable({ items, now }: { items: DeskItem[]; now: number }) {
  const [filter, setFilter] = useState<Screen | "all">("all"); const [query, setQuery] = useState(""); const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => items.filter((i) => (filter === "all" || i.screen === filter) && i.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [items, filter, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50)); const currentPage = Math.min(page, pages - 1);
  return <section className="desk-proposals" aria-labelledby="proposals-title"><div className="section-title"><div><p className="eyebrow">All proposals</p><h2 id="proposals-title">In the challenge window</h2></div><label className="desk-search">Search by title<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Team, market or question…" /></label></div>
    <div className="desk-filters" aria-label="Filter by timing screen"><button className="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(0); }}>All · {items.length}</button>{screenOrder.map((screen) => <button key={screen} className="button" aria-pressed={filter === screen} onClick={() => { setFilter(screen); setPage(0); }}>{humanScreen(screen)} · {items.filter((i) => i.screen === screen).length}</button>)}</div>
    <div className="table-scroll desk-table-scroll" role="region" aria-label="Live proposals; scroll horizontally for all columns" tabIndex={0}><table className="desk-table"><caption>{numberText(filtered.length)} matching proposals · up to 50 per page · select a title for needs and timestamps</caption><thead><tr><th scope="col">Market / proposed outcome</th><th scope="col">Scope</th><th scope="col">Game snapshot</th><th scope="col">Timing against final</th><th scope="col">Screen</th><th scope="col">SERV action</th><th scope="col">Time left</th></tr></thead><tbody>
      {filtered.slice(currentPage * 50, currentPage * 50 + 50).map((item, index) => {
        const id = item.proposal_id.full; const open = expanded === id; const detailId = `proposal-detail-${currentPage}-${index}`;
        return <Fragment key={id}><tr><th scope="row"><button className="text-button desk-title" onClick={() => setExpanded(open ? null : id)} aria-expanded={open} aria-controls={detailId}>{item.title} <span aria-hidden="true">{open ? "−" : "+"}</span></button><small>Proposed: {humanizeDecisions(item.proposed_outcome)}</small></th><td><span className="desk-scope">{humanScope(item.sports_scope)}</span></td><td><Game item={item} /></td><td>{finalTiming(item.seconds_after_final, item.screen)}</td><td><span className={`desk-chip desk-${item.flag === "LIKELY_TOO_EARLY" ? "early" : item.screen === "ON_TIME_BY_FEED" ? "on-time" : item.screen === "TOO_EARLY_BY_CODE" ? "unconfirmed" : "no-key"}`}>{item.flag === "LIKELY_TOO_EARLY" ? "Likely too early" : humanScreen(item.screen)}</span></td><td>{item.action ? humanAction(item.action) : "Not read"}</td><td className="mono desk-countdown">{countdown(item.liveness_ends_utc, now)}</td></tr>
          <tr id={detailId} hidden={!open} className="desk-detail"><td colSpan={7}>{open && <><h3>{item.action === "PROCEED" ? "Timing check complete" : "To proceed, confirm:"}</h3><Needs item={item} /><p>{readableExplanation(humanizeDecisions(humanGateReason(item.reason)))}</p><dl><dt>Proposed</dt><dd><Instant value={item.proposal_time_utc} /></dd><dt>Code cutoff</dt><dd><Instant value={item.instants.code_cutoff_utc} /></dd><dt>Evidence instant</dt><dd><Instant value={item.instants.evidence_time_utc} /></dd><dt>Scanned through</dt><dd><Instant value={item.instants.scanned_until_utc} /></dd><dt>Feed final mark</dt><dd><Instant value={item.game?.finished_utc} /></dd><dt>Challenge window ends</dt><dd><Instant value={item.liveness_ends_utc} /></dd><dt>Bond</dt><dd>{item.bond_usdc === null ? "USDC amount unavailable" : `${numberText(item.bond_usdc)} USDC`}</dd></dl><ProposalLinks item={item} />{!item.receipt_id && <p className="small muted">No SERV receipt recorded.</p>}</>}</td></tr>
        </Fragment>;
      })}
      {!filtered.length && <tr><td colSpan={7} className="desk-empty">{items.length ? "No proposals match these filters." : "No proposals are currently in a challenge window in this snapshot."}</td></tr>}
    </tbody></table></div>
    <div className="desk-pagination"><span className="small">Page {currentPage + 1} of {pages} · {filtered.length ? `${currentPage * 50 + 1}–${Math.min((currentPage + 1) * 50, filtered.length)} of ${filtered.length}` : "0 results"}</span><div><button className="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
  </section>;
}

export function LiveDesk() {
  const { snapshot, history, receivedAt, busy, error, refresh } = useLiveDesk(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    const visible = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", visible); };
  }, []);
  const items = useMemo(() => snapshot?.items.filter((item) => Date.parse(item.liveness_ends_utc) > now) ?? [], [snapshot, now]);
  const flagged = items.filter((item) => item.flag === "LIKELY_TOO_EARLY"); const t = snapshot?.totals;
  return <div className="page secondary-page live-desk"><p className="eyebrow">UMA / Polymarket / Timing</p><h1>Live desk</h1><p className="page-intro">Every UMA proposal for Polymarket markets that is in its challenge window right now, screened for timing.</p>
    <div className="desk-freshness"><div><p>{snapshot ? freshness(snapshot, receivedAt, now) : busy ? "Loading the live snapshot…" : "No snapshot available"}</p><small className="muted">Refreshes every 60 s while this tab is visible.</small></div><button className="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Refreshing…" : "Refresh ↻"}</button></div>
    {error && <p className="intake-error" role="status">Could not refresh the live desk.{snapshot?.totals ? " Showing the last successful snapshot; counts may have changed." : " Try refreshing shortly."}</p>}
    {snapshot?.stale && <p className="intake-error" role="status">The API marks this snapshot as stale. Counts and evidence may be out of date.</p>}
    {snapshot?.enabled === false && <p className="intake-status">Live collection is paused. A saved snapshot may still be available.</p>}
    {t ? <><div className="desk-stats">{[
      ["Proposals in the challenge window", numberText(t.in_liveness)], ["Bonds posted · USDC", numberText(t.bond_in_liveness_usdc)], ["Confirmed on time by evidence", numberText(t.on_time_by_feed)], ["Flagged as likely too early", t.flagged ? numberText(t.flagged) : "None right now"], ["Read by SERV", numberText(t.serv_read)],
    ].map(([label, value]) => <div className="panel" key={label}><p>{label}</p><strong>{value}</strong></div>)}</div><p className="small muted desk-count-note">Counts at the last update · {numberText(t.games)} games. Elapsed challenge windows are removed from the screen and table below.</p>
      {!!flagged.length && <section className="desk-flagged" aria-labelledby="flagged-title"><div className="section-title"><div><p className="eyebrow">Code + SERV</p><h2 id="flagged-title">Flagged · {flagged.length}</h2></div></div><div className="desk-flag-grid">{flagged.map((item) => <FlaggedCard item={item} now={now} key={item.proposal_id.full} />)}</div></section>}
      <ScreenSummary items={items} /><ProposalTable items={items} now={now} />
    </> : <div className="panel desk-empty" role="status">{busy ? "Loading proposals and timing screens…" : "The live desk has no successful snapshot available yet. Refresh to try again."}</div>}
    {!!history?.flagged && <section className="panel desk-history" aria-label="Flag history"><strong>Flag history</strong><span>Flagged {numberText(history.flagged)}</span><span>Later disputed {numberText(history.disputed)}</span><span>Settled without dispute {numberText(history.settled)}</span><p className="small muted">Rolling history of retained flags; expiry or disappearance is never counted as a settlement. Disputes do not prove a flag was correct.</p></section>}
    <section className="desk-method panel" aria-labelledby="desk-method-title"><p className="eyebrow">Method</p><h2 id="desk-method-title">Three checks. A cautious timing screen.</h2><p>SERV reads the governing rule, code checks a supported cutoff, and event evidence checks what had happened at proposal time. Proceed requires SERV approval and at least one deterministic corroboration. A likely-too-early flag requires a deterministic timing concern and a SERV reading that also finds it premature.</p><p>In one evening’s sample on November 14, 2026 (10 events, about seven games), proposals preceded the feed’s final mark by 30–331 seconds. We therefore treat “not final in the feed” as evidence of a too-early proposal only beyond 30 minutes; that margin is a policy, not a measured maximum delay. Inside it, a late final mark proves neither on-time nor too-early timing.</p><p>“No deterministic key” means the available rules or evidence cannot establish a decisive time. A full-game feed cannot time a quarter or period; an Over/Yes line may already be crossed. Read the needs before interpreting the gap. Scores and periods are the latest feed snapshot, not necessarily the state at proposal time.</p><p>Coverage: known Polymarket requesters, at most 400 latest proposed rows across two UMA deployments. USDC bonds exclude collateral without a supported USDC amount. The desk never tells anyone to dispute.</p></section>
  </div>;
}
