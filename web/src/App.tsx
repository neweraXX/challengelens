import { MarketLinkInput } from "./MarketLinkInput";
import { TimingPill, timingAnswer } from "./TimingStatus";
import { HeldOutEvidence } from "./SealedResults";
import { ActionCard } from "./ActionCard";
import { LiveDesk, LiveTeaser } from "./LiveDesk";
import { HowItDecides } from "./HowItDecides";
import { humanGateReason } from "./live-utils";
import { describeNeeds } from "../../src/gate/needs";
import { reviewPolicy } from "../../src/reppo/policy";
import type { ReppoLoop } from "../../src/reppo/changes";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import type { Benchmark, MultiBenchmark, Outcome, ShowcaseCase, Stats } from "../../src/demo/types";
import type { Verdict } from "../../src/judge/schema";
import { amount, clauseOffsets, formatTime } from "../../src/demo/math";
import { earlyYes, evaluateGate } from "../../src/gate/decide";
const ProcedureContext = createContext<string | null>(null);
import type { GateDecision } from "../../src/gate/decide";
import type { Receipt } from "../../src/gate/receipt";
import { Timeline } from "./Timeline";
import { MiniTimeline } from "./MiniTimeline";
import type { LiveResolution } from "../../src/demo/live";
import { armNames, armOrder, caseAction, eventMarker, inputsAt, selectFlagship, humanAction, groupBenchmarkModels, humanDecision, humanizeDecisions as humanText, outcomeBuckets } from "../../src/demo/evidence";

const REPOSITORY = import.meta.env.VITE_REPO_URL;
const casePath = (id: string) => `/cases/${encodeURIComponent(id)}`;
const categoryName = (category: string) => category === "sports_in_game" ? "Sports" : category === "crypto_fixed_time" ? "Crypto" : "Window";
const outcomeNames: Record<Outcome, string> = { TOO_EARLY: "Too early", upheld: "Proposal upheld", flipped: "Flipped", "50-50": "50–50", other: "Other" };
const finalDecision = (item: ShowcaseCase) => item.receipt?.final_decision ?? item.final_decision ?? evaluateGate(inputsAt(item, item.proposal_time_utc), item.verdict).final_decision;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json() as Promise<T>;
}
function Link({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  function go(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  }
  return <a href={href} onClick={go} className={className} aria-current={className === "active" ? "page" : undefined}>{children}</a>;
}
function Time({ value }: { value: string | number }) {
  return <time dateTime={new Date(value).toISOString()} className="time-pair"><span>{formatTime(value, "UTC", true)} UTC</span><small>{formatTime(value, "America/New_York", true)} ET</small></time>;
}
function External({ hash, children }: { hash: string | null; children: ReactNode }) {
  return hash && /^0x[0-9a-f]{64}$/iu.test(hash) ? <a href={`https://polygonscan.com/tx/${hash}`} target="_blank" rel="noreferrer">{children} ↗</a> : <span>{children} · transaction unavailable</span>;
}

export function App() {
  const [procedure, setProcedure] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); getJson<{ procedure_version: string }>("/data/procedure.json", controller.signal).then((value) => setProcedure(value.procedure_version)).catch(() => {}); return () => controller.abort(); }, []);
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const page = path === "/live" ? "Live desk" : path === "/check" ? "Check a market" : path === "/" ? "Home" : path === "/cases" || path === "/case" || path.startsWith("/cases/") ? "Historical replay" : path === "/benchmark" ? "Benchmark" : path === "/api" ? "API" : "Missing";
  const selectedCasePath = page === "Historical replay" && path.startsWith("/cases/") && path.slice(7) ? path : "/cases";
  useEffect(() => { document.title = `${page} · ChallengeLens`; }, [page]);
  return <ProcedureContext.Provider value={procedure}>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="wordmark"><svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><path d="M4 6h22v18H4zM10 3v6M20 3v6M9 16h5l3-4 4 8" /></svg>Challenge<span>Lens</span></Link>
      <nav aria-label="Main navigation">{[["/", "Home"], ["/check", "Check a market"], ["/live", "Live desk"], [selectedCasePath, "Historical replay"], ["/benchmark", "Benchmark"], ["/api", "API"]].map(([href, label]) =>
        <Link href={href!} key={href} className={page === label ? "active" : ""}>{label}</Link>)}</nav>
      <Link href="/check" className="button primary nav-cta">Check a market <span aria-hidden="true">→</span></Link>
    </div></header>
    <main id="main" tabIndex={-1}>
      {page === "Live desk" ? <LiveDesk /> : page === "Check a market" ? <CheckPage /> : page === "Home" ? <Home /> : page === "Historical replay" ? <CasePage key={path} id={decodeURIComponent(selectedCasePath.slice(7))} /> : page === "Benchmark" ? <BenchmarkPage /> : page === "API" ? <ApiPage /> :
        <div className="page empty"><h1>Case not found</h1><Link href="/">Return to the dispute feed →</Link></div>}
    </main>
    <footer className="page site-footer"><span>ChallengeLens <span className="muted">/ Before the bond.</span></span><span>Independent project. Not affiliated with Polymarket, UMA, OpenServ or Reppo. Timing check only; not financial advice. <Link href="/benchmark">Method & evidence ↗</Link></span></footer>
  </ProcedureContext.Provider>;
}

function Home() {
  const [data, setData] = useState<{ cases: ShowcaseCase[]; stats: Stats } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getJson<ShowcaseCase[]>("/data/showcase.json", controller.signal), getJson<Stats>("/api/stats", controller.signal)])
      .then(([cases, stats]) => setData({ cases, stats })).catch((reason: Error) => { if (reason.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, []);
  const [url, setUrl] = useState("");
  function startCheck(value: string) {
    window.history.pushState({}, "", `/check?url=${encodeURIComponent(value)}&resolve=1`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  }
  const flagship = data ? selectFlagship(data.cases) : undefined;
  const feed = data ? [...data.cases].sort((a, b) => Number(finalDecision(b) === "NOT_SUPPORTED_NOW") - Number(finalDecision(a) === "NOT_SUPPORTED_NOW")) : [];
  return <div className="page">
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">Before the bond.</p><h1>Check a proposal before you put money on it.</h1>
        <p className="hero-subtitle">See whether a Polymarket proposal is too early, supported by timing, or needs more evidence.</p>
        <MarketLinkInput home url={url} onChange={setUrl} onResolve={startCheck} />
        <p className="timing-scope">Timing only, not outcome. Independent of Polymarket.</p>
      </div>
      {flagship ? <HeroPreview item={flagship} /> : <div className="hero-preview loading-surface" aria-busy={!error}>{error ? "The case feed is unavailable. Please reload once showcase data is ready." : data ? "No replay with a deterministic timing check is available yet." : "Loading the real proposal record…"}</div>}
    </section>
    <section className="how-it-works" aria-labelledby="how-it-works-title"><h2 id="how-it-works-title">How it works</h2><ol>
      <li><span className="step-number">1</span><div><strong>Paste a market link</strong><p>Choose the market and proposed side.</p></div></li>
      <li><span className="step-number">2</span><div><strong>Check the timing</strong><p>The rule, clock and facts get a check.</p></div></li>
      <li><span className="step-number">3</span><div><strong>See the answer</strong><p>Read what is known and what is missing.</p></div></li>
    </ol></section>
    <HowItDecides item={flagship} />
    <LiveTeaser />
    {data && <>
      <section className="dispute-summary" aria-labelledby="disputes-title"><div className="section-title"><div><p className="eyebrow">Why timing matters</p><h2 id="disputes-title"><span className="sample-stat">44%</span> of sampled disputed requests settled as too early.</h2></div><span className="muted">{data.stats.total.toLocaleString()} disputed requests in this sample</span></div><OutcomeChart stats={data.stats} /></section>
      <section className="gate-catches panel" aria-labelledby="gate-catches-title"><p className="eyebrow">Historical replay / Evidence</p><h2 id="gate-catches-title">The deterministic checks caught it</h2>
        <div className="table-scroll"><table><thead><tr><th>Market</th><th>SERV said</th><th>Gate said</th><th>UMA settled</th></tr></thead><tbody>
          {data.cases.filter((item) => item.verdict.decision === "SUPPORTED_NOW" && finalDecision(item) !== "SUPPORTED_NOW").map((item) => <tr key={item.case_id}><th><Link href={casePath(item.case_id)}>{item.title}</Link><SourceTag value="Historical replay" /></th><td><DecisionChip decision={item.verdict.decision} /></td><td><DecisionChip decision={finalDecision(item)} /></td><td><span className="verdict-chip" data-decision={item.settlement_label === "TOO_EARLY" ? "NOT_SUPPORTED_NOW" : "INSUFFICIENT_EVIDENCE"}>{item.settlement_label ? outcomeNames[item.settlement_label] : "Unavailable"}</span></td></tr>)}
        </tbody></table></div><p className="small muted">Oracle settlements are timing proxies; binary settlements do not prove timing.</p>
      </section>
      <section className="feed" aria-labelledby="feed-title"><div className="section-title"><div><p className="eyebrow">The dispute desk</p><h2 id="feed-title">Historical replay</h2></div><span className="muted">{feed.length} proposal records</span></div>
        <div className="case-grid">{feed.map((item, index) => <Link className="case-tile" href={casePath(item.case_id)} key={item.case_id}>
          <div className="tile-top"><span className="eyebrow">{String(index + 1).padStart(2, "0")} / {categoryName(item.category)}</span><span aria-hidden="true">↗</span></div>
          <h3>{item.title}</h3><SourceTag value="Historical replay" /><div className="tile-verdict"><TimingPill action={caseAction(item)} /><span className="eyebrow">Final timing</span></div><MiniTimeline item={item} /><div className="mini-legend"><span>│ Proposal</span><span>{eventMarker(item)?.label ?? (item.verdict.decisive_time_utc ? "┆ Timing boundary" : "Cutoff unavailable")}</span></div><p>{humanGateReason(item.receipt?.gate.gate_reason ?? item.gate?.gate_reason ?? relativeProposal(item))}</p>
          <div className="tile-bottom"><span className="numeric">{amount(item.bond, item.currency) ? `Bond ${amount(item.bond, item.currency)}` : "Bond not recorded"}</span><span className="muted">Open record →</span></div>
        </Link>)}</div>
      </section>
    </>}
  </div>;
}

function relativeProposal(item: ShowcaseCase): string {
  const marker = eventMarker(item);
  const target = marker?.time ?? item.gamma_time_utc ?? item.verdict.decisive_time_utc;
  if (!target) return "Explore the governing observation window.";
  const differenceMs = Date.parse(target) - Date.parse(item.proposal_time_utc);
  const difference = differenceMs / 60_000;
  const minutes = Math.round(Math.abs(difference));
  const delta = Math.abs(differenceMs) < 60_000 ? `${Number((Math.abs(differenceMs) / 1000).toFixed(3))}s` : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  const moved = item.rules_time_utc !== null && item.gamma_time_utc !== null && Date.parse(item.rules_time_utc) !== Date.parse(item.gamma_time_utc);
  const event = marker ? marker.label.toLowerCase() : item.category === "sports_in_game" && item.gamma_time_utc ? moved ? "rescheduled start" : "scheduled start" : "SERV’s cutoff";
  return `Proposed ${delta} ${difference > 0 ? "before" : "after"} ${event}.`;
}

function HeroPreview({ item }: { item: ShowcaseCase }) {
  const procedure = useContext(ProcedureContext);
  const marker = eventMarker(item);
  return <Link className="hero-preview" href={casePath(item.case_id)}>
    <div className="preview-state" data-action={caseAction(item)}><TimingPill action={caseAction(item)} /><span>{timingAnswer(caseAction(item), item.earliest_utc)}</span></div>
    <div className="preview-top"><span className="eyebrow featured-label">Featured replay</span>{procedure && <span className="stamp">{procedure}</span>}</div>
    <h2>{item.title}</h2><p className="preview-sub">{humanGateReason(item.receipt?.gate.gate_reason ?? item.gate?.gate_reason ?? relativeProposal(item))}</p><SourceTag value="Historical replay" />
    <div className="flagship-timeline"><MiniTimeline item={item} />{marker && <p className="small"><strong>{marker.label}</strong><br /><time dateTime={marker.time}>{marker.time}</time></p>}</div>
    <div className="preview-detail"><div><span className="eyebrow">At the proposal</span><TimingPill action={caseAction(item)} /></div><div><span className="eyebrow">Bond at risk</span><strong>{amount(item.bond, item.currency) ?? "Not recorded"}</strong></div></div>
    <div className="preview-footer"><span>Explore the timeline and see what changes.</span><span aria-hidden="true">→</span></div>
  </Link>;
}

function OutcomeChart({ stats }: { stats: Stats }) {
  let offset = 0;
  return <><svg className="outcome-chart" viewBox="0 0 1000 38" preserveAspectRatio="none" role="img" aria-label={Object.entries(stats.outcomes).filter(([, count]) => count > 0).map(([key, count]) => `${outcomeNames[key as Outcome]} ${count}`).join(", ")}>
    <defs><pattern id="outcome-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" x2="0" y1="0" y2="8" className="hatch-line" /></pattern></defs>
    {(Object.entries(stats.outcomes) as [Outcome, number][]).filter(([, count]) => count > 0).map(([key, count]) => {
      const width = stats.total ? count / stats.total * 1000 : 0;
      const x = offset; offset += width;
      return <g key={key}><rect x={x} y="0" width={width} height="38" className={`outcome-${key}`} />{key === "TOO_EARLY" && <rect x={x} y="0" width={width} height="38" fill="url(#outcome-hatch)" />}<title>{outcomeNames[key]}: {count}</title></g>;
    })}</svg>
    <p className="sample-caption">{stats.outcomes.TOO_EARLY} of {stats.total} sampled disputed requests settled with UMA's TOO_EARLY value (2022–2026 sample). Disputed requests only; this is not the rate across all proposals.</p>
    <div className="outcome-legend">{(Object.entries(stats.outcomes) as [Outcome, number][]).filter(([, count]) => count > 0).map(([key, count]) => <div key={key}><i className={`swatch outcome-${key}`} /><span>{key === "TOO_EARLY" ? "◷ " : ""}{outcomeNames[key]}</span><strong className="numeric">{count}</strong></div>)}</div>
    <details className="year-counts"><summary>View disputed proposals by year</summary><div className="table-scroll"><table><thead><tr><th>Proposal year</th>{Object.keys(stats.outcomes).filter((key) => stats.outcomes[key as Outcome] > 0).map((key) => <th key={key}>{outcomeNames[key as Outcome]}</th>)}</tr></thead><tbody>{Object.entries(stats.by_year).sort().map(([year, outcomes]) => <tr key={year}><th>{year}</th>{Object.keys(stats.outcomes).filter((key) => stats.outcomes[key as Outcome] > 0).map((key) => <td key={key}>{outcomes[key as Outcome]}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

function CopyCaseId({ id, kind = "case" }: { id: string; kind?: "case" | "evaluation" }) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(id); setFeedback("Copied"); }
    catch { setFeedback("Copy unavailable"); }
  }
  return <div className="case-id-copy"><button type="button" className="text-button mono" title={id} aria-label={`Copy ${kind} ID ${id}`} onClick={copy}><span>{id.slice(0, 13)}…{id.slice(-6)}</span><small>Copy</small></button><span role="status">{feedback}</span></div>;
}

function DecisionChip({ decision }: { decision: string }) { return <span className="verdict-chip" data-decision={decision} title={`${decision}: ${humanDecision(decision)}`}><span aria-hidden="true">{decision === "SUPPORTED_NOW" ? "✓" : decision === "NOT_SUPPORTED_NOW" ? "◷" : "ⓘ"} </span>{decision === "SUPPORTED_NOW" ? "Timing is supported" : decision === "NOT_SUPPORTED_NOW" ? "Too early" : "Needs evidence"}</span>; }

function SourceTag({ value }: { value: string }) { return <small className="source-tag">{value}</small>; }

function CheckPage() {
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get("url") ?? "");
  const started = useRef(false);
  const [resolution, setResolution] = useState<LiveResolution | null>(null);
  const [marketId, setMarketId] = useState("");
  const [side, setSide] = useState(0);
  const [mode, setMode] = useState("now");
  const [clock, setClock] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState<"resolve" | "check" | null>(null);
  const [error, setError] = useState<{ message: string; rate: boolean } | null>(null);
  const [result, setResult] = useState<ShowcaseCase | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    const value = query.get("url");
    if (value && query.get("resolve") === "1") void resolveMarket(value);
  }, []);
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string; retry_after?: number };
    if (!response.ok) { const rate = response.status === 429; throw Object.assign(new Error(`${rate ? "Rate limited. " : response.status >= 500 ? "Upstream error. " : ""}${payload.error ?? "Request failed"}${rate ? ` Retry in ${payload.retry_after || response.headers.get("Retry-After") || 3}s.` : ""}`), { rate }); }
    return payload as T;
  }
  function selectMarket(id: string, value = resolution) {
    setMarketId(id); setResult(null);
    const market = value?.markets.find((m) => m.id === id);
    const no = market?.outcomes.findIndex((outcome) => outcome.toUpperCase() === "NO") ?? -1;
    setSide(no < 0 ? 0 : no);
  }
  async function resolveMarket(value: string) {
    setBusy("resolve"); setError(null); setResult(null); setResolution(null); setUrl(value);
    try { const data = await post<LiveResolution>("/api/market/resolve", { url: value }); setResolution(data); selectMarket(data.selected_market_id ?? "", data); }
    catch (reason) { setError({ message: reason instanceof Error ? reason.message : "Upstream error. Try again.", rate: Boolean((reason as { rate?: boolean }).rate) }); }
    finally { setBusy(null); }
  }
  async function checkMarket() {
    setBusy("check"); setError(null); setResult(null);
    try { const data = await post<{ timeline: ShowcaseCase }>("/api/market/check", { market_id: marketId, proposed_side: side,
      ...(mode === "now" ? {} : { check_time_utc: `${clock}:00Z` }) }); setResult(data.timeline); }
    catch (reason) { setError({ message: reason instanceof Error ? reason.message : "Upstream error. Try again.", rate: Boolean((reason as { rate?: boolean }).rate) }); }
    finally { setBusy(null); }
  }
  function offset(hours: number) { setClock(new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16)); setMode("custom"); }
  const market = resolution?.markets.find((m) => m.id === marketId);
  return <div className="page check-page"><p className="eyebrow">Before the bond / Gamma live</p><h1>Check a market</h1>
    <p className="page-intro">Find out whether the timing supports your proposal. Timing only, not outcome.</p>
    <ol className="check-progress" aria-label="Check steps"><li aria-current={!resolution ? "step" : undefined}><span>1</span> Paste link</li><li aria-current={resolution && !result ? "step" : undefined}><span>2</span> Pick market and side</li><li aria-current={result ? "step" : undefined}><span>3</span> Result</li></ol>
    <MarketLinkInput url={url} busy={busy !== null} onChange={(value) => { setUrl(value); setResolution(null); setResult(null); }} onResolve={(value) => void resolveMarket(value)} />
    {!resolution && <section className="check-explainer" aria-label="How to check a market"><ol>{[
      ["M7 12h10M13 8l4 4-4 4M5 5h14v14H5z", "Paste a Polymarket link"],
      ["M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4", "Pick the market and side"],
      ["M3 9a3 3 0 1 1 6 0 3 3 0 0 1-6 0M9 9h5v3h3M13 17h8M13 20h5", "See whether its timing is supported: three checks + receipt"],
    ].map(([path, text], index) => <li key={text}><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={path} /></svg><span><small>{index + 1}</small>{text}</span></li>)}</ol><p className="small muted">Supported: crypto price at a fixed time, Up/Down candles, and date windows. Sports need proof the game finished.</p></section>}
    {resolution && <section className="market-options panel"><label>Market<select value={marketId} disabled={busy !== null} onChange={(event) => selectMarket(event.target.value)}><option value="" disabled>Choose one of {resolution.markets.length} markets</option>{resolution.markets.map((m) => <option key={m.id} value={m.id}>{m.question}{m.closed ? " · Closed" : ""}</option>)}</select></label>
      {market && <><label>Proposed side<select value={side} disabled={busy !== null} onChange={(event) => { setSide(Number(event.target.value)); setResult(null); }}>{market.outcomes.map((outcome, index) => <option key={index} value={index}>{outcome}</option>)}</select></label>
        <div className="check-clock"><label>Check time (UTC)<select value={mode} disabled={busy !== null} onChange={(event) => setMode(event.target.value)}><option value="now">Now</option><option value="custom">Choose time</option></select></label>{mode === "custom" && <input aria-label="Custom check time in UTC" type="datetime-local" value={clock} disabled={busy !== null} onChange={(event) => setClock(event.target.value)} />}
          <div className="time-offsets">{[-1, 1, 24].map((hours) => <button className="text-button" type="button" disabled={busy !== null} key={hours} onClick={() => offset(hours)}>{hours > 0 ? "+" : ""}{hours}h</button>)}</div></div>
        <button type="button" className="button primary" disabled={busy !== null || mode === "custom" && !clock} onClick={() => void checkMarket()}>{busy === "check" ? "Checking timing…" : "Check timing ↗"}</button></>}
      <p className="small muted market-provenance">Gamma’s current question and description; not onchain ancillary bytes. No oracle proposal exists yet. Market list fetched {formatTime(resolution.fetched_at)} UTC. {market ? `${market.closed ? "Closed" : market.active ? "Active" : "Activity unconfirmed"}. ` : ""}Checks use the start of the selected UTC minute.</p>
    </section>}
    {busy && <p role="status" className="intake-status">{busy === "resolve" ? "Loading current Gamma markets…" : "Checking the selected market…"}</p>}
    {error && <p role="alert" className={`intake-error${error.rate ? " rate-limited" : ""}`}>{error.message}</p>}
    {result?.serv_called === false && <p role="status" className="unsupported-notice">Market type not supported yet. Supported families: fixed-time crypto prices and candles, sports with a stated scheduled time, and explicit timed observation windows. No SERV call was made.</p>}
    {result && <CaseWorkspace key={result.packet_hash} item={result} />}
  </div>;
}

function CasePage({ id }: { id: string }) {
  const [item, setItem] = useState<ShowcaseCase | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (id ? getJson<ShowcaseCase>(`/api/cases/${encodeURIComponent(id)}`, controller.signal) : getJson<ShowcaseCase[]>("/data/showcase.json", controller.signal).then((items) => { const selected = selectFlagship(items); if (!selected) throw new Error("No featured replay"); return selected; })).then(setItem).catch((reason: Error) => { if (reason.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [id]);
  return item ? <CaseWorkspace item={item} /> : <div className="page empty" role="status">{error ? "This case could not be loaded." : "Loading proposal record…"} {error && <Link href="/">Return to Home →</Link>}</div>;
}

function CaseWorkspace({ item: initial }: { item: ShowcaseCase }) {
  const [item, setItem] = useState(initial);
  const live = item.source === "gamma_live";
  const original = Date.parse(item.proposal_time_utc);
  const [time, setTime] = useState(original);
  const [reveal, setReveal] = useState(false);
  const [reviewedReceipt, setReviewedReceipt] = useState<Receipt | null>(null);
  const [remote, setRemote] = useState<{ time: number; verdict: Verdict; receipt: Receipt; cached: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const source = remote?.time === time ? remote.verdict : item.verdict;
  const baseReceipt = remote?.time === time ? remote.receipt : item.receipt;
  const receipt = reviewedReceipt?.receipt_id === baseReceipt?.receipt_id ? reviewedReceipt ?? baseReceipt : baseReceipt;
  const reviewMatches = Boolean(receipt && Date.parse(receipt.proposal_time_utc) === time && receipt.packet_hash === item.packet_hash);
  const evidence = remote?.receipt.evidence ?? item.evidence ?? receipt?.evidence;
  const result: GateDecision = item.serv_called === false && item.gate ? { action: "NEED_EVIDENCE", final_decision: "INSUFFICIENT_EVIDENCE", final_reason: null, gate: item.gate, needs: item.needs ?? ["NEED_CUTOFF_READING"] } as GateDecision : evaluateGate(inputsAt(item, new Date(time).toISOString(), evidence), source, remote?.time === time ? new Date(remote.time).toISOString() : item.proposal_time_utc);
  result.evidence = evidence;
  const simulated = time !== original && remote?.time !== time;
  const authoritative = reviewMatches ? receipt : !simulated && !remote ? item : null;
  const policy = reviewPolicy(authoritative?.final_decision ?? result.final_decision, reviewMatches ? receipt?.reppo : null, authoritative?.action ?? result.action);
  const action = simulated && policy.action === "PROCEED" ? "NEED_EVIDENCE" : policy.action;
  // Saved API details belong to their checked instant; timeline simulations need fresh local needs.
  const needDetails = simulated ? result.need_details : authoritative?.need_details ?? result.need_details ?? item.need_details;
  result.need_details = needDetails?.length ? needDetails : describeNeeds(result.needs, result.earliest_utc);
  const offsets = clauseOffsets(item.rules_text, source.checks.timing.clause_quote) ?? item.clause_offsets;
  const timelineItem = { ...item, evidence };
  let sourceTag = "Historical replay";
  if (item.serv_called === false) sourceTag = "No SERV call (unsupported)";
  else if (simulated) sourceTag = "Recomputed locally (drag)";
  else if (remote?.time === time) sourceTag = remote.cached ? "Cached SERV check" : "Fresh SERV check";
  else if (live) sourceTag = item.cached ? "Cached SERV check" : "Fresh SERV check";
  async function recheck() {
    const requested = time;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(live ? "/api/market/check" : "/api/check", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(live ? { market_id: item.live_packet!.market_id, proposed_side: item.live_packet!.proposed_outcome_index, check_time_utc: new Date(requested).toISOString() } : { case_id: item.case_id, proposal_time_utc: new Date(requested).toISOString() }) });
      const data = await response.json() as { error?: string; verdict: Verdict; receipt: Receipt; cached: boolean; timeline?: ShowcaseCase };
      if (!response.ok) throw new Error(data.error ?? "SERV check failed");
      if (live && data.timeline) setItem(data.timeline);
      setRemote({ time: requested, verdict: data.verdict, receipt: data.receipt, cached: data.cached });
      setMessage(data.cached ? "Validated SERV result loaded from cache." : "SERV returned a fresh judgment.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Check failed. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className={live ? "live-workspace" : "page case-page"}>
    {!live && <div className="case-breadcrumb"><Link href="/">← Historical replay</Link><CopyCaseId id={item.case_id} /></div>}
    <div className="case-heading"><div><p className="eyebrow">{categoryName(item.category)} / {live ? "Gamma live · no oracle proposal" : "Historical replay"}</p><h1>{item.title}</h1></div>{!live && <span className="bond-chip">Bond <strong>{amount(item.bond, item.currency) ?? "not recorded"}</strong> at risk</span>}</div>
    <div className="case-workspace">
      <section className="timeline-panel panel" aria-labelledby="timeline-title"><div className="panel-title"><div><p className="eyebrow">Explore the timing</p><h2 id="timeline-title">Move the proposal.</h2></div><button className="button small-button" onClick={() => { setTime(original); setRemote(null); setMessage(""); }}>Reset ↺</button></div>
        <p className="muted small">Move the proposal to see when the timing changes. Arrow keys move 1 minute; Shift + arrow moves 15.</p>
        <Timeline item={timelineItem} time={time} gate={result.gate} cutoff={result.gate.code_cutoff_utc ?? source.decisive_time_utc} earlyNeedsEvidence={earlyYes(item.model_inputs)} reveal={reveal} onChange={setTime} />
        <div className="timeline-toolbar"><div><span className="eyebrow">{time === original ? "Actual proposal" : "Your proposal time"}</span><Time value={time} /></div><span className="stamp">Liveness / Oracle proposal</span></div>
        {!live && <div className="reveal-block"><button className="reveal-button" aria-expanded={reveal} aria-controls="settlement-result" onClick={() => setReveal(!reveal)}>{reveal ? "Hide UMA settlement" : "Reveal what UMA decided"} <span aria-hidden="true">{reveal ? "−" : "+"}</span></button>
          {reveal && <div id="settlement-result" className="settlement"><strong>{item.settlement_label === "TOO_EARLY" ? "UMA settled: TOO EARLY." : item.settlement_label === "upheld" ? "UMA settled: proposal upheld." : "UMA settled: proposal flipped."}</strong>
            <p>{item.settlement_label === "TOO_EARLY" ? "The proposal was rejected as premature." : item.settlement_label === "upheld" ? "UMA’s settled value matched the proposal. Binary settlement alone does not prove the original timing was valid." : "UMA’s settled value differed from the proposal. Binary settlement alone does not prove the original timing was valid."}</p>
            {item.settlement_time_utc && <Time value={item.settlement_time_utc} />}<div className="settlement-links"><External hash={item.settlement_tx_hash}>Verify settlement on Polygonscan</External><External hash={item.proposal_tx_hash}>View proposal on Polygonscan</External></div><details><summary>Raw settlement value</summary><code>{item.settlement_value}</code></details>
          </div>}
        </div>}
      </section>
      <ActionCard result={result} source={source} action={action} simulated={simulated} time={time} sourceTag={sourceTag} receipt={receipt} reviewMatches={reviewMatches} busy={busy} message={message} recheck={recheck} onReceipt={setReviewedReceipt} servCalled={item.serv_called !== false} />
      <section className="rules-panel panel"><p className="eyebrow">The original rule</p><h2>Read the rule.</h2><p className="muted small">{live ? "Rules from Gamma’s current question and description, not onchain ancillary bytes. No oracle proposal exists yet." : "SERV’s quoted clause is highlighted in the original ancillary text."}</p>
        {live && item.live_packet && <p className="small muted">Gamma snapshot fetched {formatTime(item.live_packet.fetched_at)} UTC.</p>}
        <div className="rules-text">{item.rules_text.slice(0, offsets.start)}<mark id="governing-clause" tabIndex={-1}>{item.rules_text.slice(offsets.start, offsets.end)}</mark>{item.rules_text.slice(offsets.end)}</div>
        <div className="record-meta"><span className="eyebrow">{live ? "Gamma market ID" : "Request ID"}</span><code>{live ? item.live_packet?.market_id : item.request_id}</code>{!live && <External hash={item.proposal_tx_hash}>Proposal transaction</External>}</div>
      </section>

    </div>
    {item.raw_verdict && <section className="raw-comparison panel"><p className="eyebrow">Same historical packet</p><h2>Model only vs SERV on this case</h2><SourceTag value="Historical replay" /><div><span>Model only <strong>{humanDecision(item.raw_verdict.decision)}</strong></span><span>SERV <strong>{humanDecision(item.verdict.decision)}</strong></span><span>Final <strong>{humanDecision(finalDecision(item))}</strong></span></div><p className="muted small">Model-only source: {item.raw_run}. One valid trial shown; full consistency is reported on Benchmark.</p></section>}
  </div>;
}

function BenchmarkPage() {
  const [data, setData] = useState<MultiBenchmark | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { const controller = new AbortController();
    getJson<MultiBenchmark | Benchmark>("/data/benchmark.json", controller.signal).then((value) => {
      if ("models" in value) setData(value);
      else setData({ label: value.label, sealed: value.sealed, models: [{ model: "Legacy benchmark · regenerate from regated runs", run: value.run, source: value.source, procedure: value.procedure,
        rows: { ...value.arms, "raw+gate": null, "serv+gate": null } }] });
    }).catch((reason: Error) => { if (reason.name !== "AbortError") setError(true); }); return () => controller.abort(); }, []);
  const groups = groupBenchmarkModels(data?.models ?? []);
  const primary = groups[0];
  return <div className="page secondary-page evidence-page"><p className="eyebrow">Held-out evidence / Three checks</p><h1>What passed.<br />What was held.</h1>
    <p className="page-intro">Start with the frozen blind test, then compare the explicitly labelled second look with evidence keys. Development measurements follow.</p>
    <HeldOutEvidence />
    <section className="development-evidence"><p className="eyebrow">03 / Development evidence</p><h2>Development checks</h2>
    {data ? <><p className="small muted evidence-scope">{data.label} · Primary model: {primary?.model ?? "unavailable"}. Three repeated readings per case; these are development results.</p>{groups.map((model) => <section key={`${model.model}:${model.procedure}`} className="benchmark-model panel">
      <div className="benchmark-heading"><div><p className="eyebrow">{model.procedure === primary?.procedure ? "Primary procedure" : `Earlier procedure (${model.procedure})`}</p><h2>{model.model}</h2><p className="small mono muted">{model.procedure} · {model.runs.join(" · ")}</p></div><SourceTag value="Development set" /></div>
      <div className="evidence-charts"><section aria-label="Dangerous approval chart"><h3>Dangerous approvals on too-early proposals</h3><p className="small muted">Each square is one check on a too-early proposal. Red × means approved too early.</p>
        {armOrder.map((arm) => { const metric = model.rows[arm]; return <div className="unit-row" key={arm}><span>{armNames[arm]}</span>{metric ? <><div className="unit-squares" role="img" aria-label={`${armNames[arm]}: ${metric.false_supported} dangerous approvals out of ${metric.premature_trials}`}>
          {Array.from({ length: metric.premature_trials }, (_, index) => <i key={index} className={index < metric.false_supported ? "danger-fill" : ""} />)}</div><strong className="numeric">{metric.false_supported}/{metric.premature_trials}</strong></> : <span className="muted">Not run</span>}</div>; })}
      </section><section aria-label="All check outcomes"><h3>What happened to all {Math.max(...armOrder.map((arm) => model.rows[arm]?.trials ?? 0))} checks</h3><p className="small muted">A correct abstention is counted as correct. Invalid or missing checks appear as gaps.</p>
        {armOrder.map((arm) => { const metric = model.rows[arm]; const buckets = metric && outcomeBuckets(metric); return <div className="stack-row" key={arm}><span>{armNames[arm]}</span>{metric && buckets ? <><div className="check-stack" role="img" aria-label={Object.entries(buckets).map(([key, value]) => `${bucketNames[key]}: ${value}`).join(", ")}>
          {Object.entries(buckets).map(([key, value]) => value > 0 && <span key={key} className={`bucket-${key}`} style={{ width: `${100 * value / metric.trials}%` }} title={`${bucketNames[key]}: ${value}`}>{value}</span>)}</div><span className="numeric small">{metric.trials}</span></> : <span className="muted">Not run</span>}</div>; })}
        <div className="chart-legend">{Object.entries(bucketNames).filter(([key]) => key !== "unscored" || armOrder.some((arm) => { const metric = model.rows[arm]; return metric && metric.valid < metric.trials; })).map(([key, name]) => <span key={key}><i className={`bucket-${key}`} />{name}</span>)}</div>
      </section></div>
      <details className="evidence-table"><summary>Exact counts, consistency, tokens and recorded cost</summary><div className="table-scroll"><table><caption>{model.model} · {model.procedure}. Counts use all planned checks.</caption><thead><tr><th>Arm</th><th>Correct</th><th>Abstained (all)</th><th>Other incorrect answers</th><th>Approved a too-early proposal</th><th>Unscored</th><th>Consistent cases</th><th>Tokens</th><th>Recorded cost</th></tr></thead><tbody>
        {armOrder.map((arm) => { const metric = model.rows[arm]; const buckets = metric && outcomeBuckets(metric); return <tr key={arm}><th>{armNames[arm]}</th>{metric && buckets ? <><td>{metric.correct}/{metric.trials}</td><td>{metric.abstained}/{metric.trials}</td><td>{buckets.safe}</td><td>{metric.false_supported}/{metric.premature_trials}</td><td>{buckets.unscored}</td><td>{metric.consistent_cases}/{metric.cases}</td><td>{metric.tokens.toLocaleString()}</td><td>{metric.cost_usd === null ? "Unreported" : `$${metric.cost_usd.toFixed(4)}`}</td></> : <td colSpan={8}>Not run</td>}</tr>; })}
      </tbody></table></div></details><p className="small muted">Accuracy matches both decision and reason. Consistency requires three valid matching decisions and reasons. Deterministic checks reuse the same saved responses, tokens and cost; zero extra inference calls. Complementary runs are merged; the first available arm is used if runs overlap.</p>
    </section>)}</> : <p role="status">{error ? "Benchmark data is unavailable. Regenerate benchmark.json." : "Loading benchmark…"}</p>}
    </section><ReppoFeedbackLoop />
    <section className="method"><h2>Limits of this evidence</h2><p>Development cases informed the procedure. The blind baseline stays frozen; the second look was measured after unblinding. Repetitions measure consistency, not independent events. Labels are oracle-settlement timing proxies; binary settlements do not prove timing. Current Gamma scheduling may differ from history. Estimated sports ends never prove completion.</p></section>
  </div>;
}

const bucketNames: Record<string, string> = { correct: "Correct", abstained: "Held for evidence", safe: "Other incorrect answers", dangerous: "Dangerous approval", unscored: "Unscored" };
const metricLabel = (key: string) => key === "run" ? "Run" : key.replace(/^serv_/u, "SERV · ").replace(/^gated_/u, "With second key · ").replace(/false_supported/gu, "dangerous approvals").replace(/consistent/gu, "consistent cases").replace(/_/gu, " ");

function ReppoFeedbackLoop() {
  const [data, setData] = useState<ReppoLoop | null>(null);
  useEffect(() => { const controller = new AbortController();
    getJson<ReppoLoop>("/data/reppo-loop.json", controller.signal).then(setData).catch(() => {});
    return () => controller.abort();
  }, []);
  return <section className="reppo-loop method"><h2>Reppo feedback loop</h2><p>Reppo’s evaluator panel reviews saved verdicts; critiques become explicit, versioned procedure changes; every change is re-measured.</p>
    {!data && <p className="small muted">Feedback records are not available yet.</p>}
    {data && !data.changes.length && <p className="small muted">No procedure changes recorded yet.</p>}
    {data?.changes.map((change, index) => { const before = change.dev_before as Record<string, unknown>; const after = change.dev_after as Record<string, unknown>; const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]; return <article className="feedback-card panel" key={`${change.date}:${index}`}><div className="feedback-heading"><p className="numeric small">{change.from_version} → {change.to_version} · {change.date}</p><span className={`verdict-chip ${change.accepted ? "feedback-accepted" : "feedback-rejected"}`}>{change.accepted ? "Accepted" : "Rejected"}</span></div><blockquote>“{humanText(change.critique_summary)}”</blockquote><p><strong>What changed:</strong> {humanText(change.change)}</p>
      {!!keys.length && <div className="table-scroll"><table className="change-metrics"><caption>Development before → after</caption><thead><tr><th>Measure</th><th>Before</th><th>After</th></tr></thead><tbody>{keys.map((key) => <tr key={key}><th>{metricLabel(key)}</th><td>{String(before?.[key] ?? "—")}</td><td>{String(after?.[key] ?? "—")}</td></tr>)}</tbody></table></div>}
      <div className="feedback-ids"><span className="small muted">Reppo evaluation IDs</span>{change.reppo_eval_ids.map((id) => <CopyCaseId key={id} id={id} kind="evaluation" />)}{!change.reppo_eval_ids.length && <span>None recorded</span>}</div></article>; })}
  </section>;
}

function ApiPage() {
  const procedure = useContext(ProcedureContext);
  const origin = window.location.origin;
  const liveAgent = [
    'const response = await fetch("/api/live");',
    'if (!response.ok) throw new Error("Live desk unavailable");',
    'const desk = await response.json();',
    'if (desk.stale || !desk.totals) throw new Error("No fresh snapshot");',
    'const flagged = desk.items.filter(p => p.flag === "LIKELY_TOO_EARLY" && Date.parse(p.liveness_ends_utc) > Date.now());',
    'for (const p of flagged) console.log(p.title, p.proposed_outcome, p.reason, p.uma_url);',
  ].join("\n");
  const curl = [`curl '${origin}/api/market/check' \\`, "  -H 'Content-Type: application/json' \\", `  --data '${JSON.stringify({ market_id: "REPLACE_WITH_MARKET_ID", proposed_side: "YES" })}'`].join("\n");
  const agent = [
    'const response = await fetch("/api/market/check", { method: "POST", headers: { "Content-Type": "application/json" },',
    '  body: JSON.stringify({ market_id, proposed_side: "YES" }) });',
    'if (!response.ok) throw new Error("Timing check failed");',
    'const { action, earliest_utc, receipt } = await response.json();',
    'if (action !== "PROCEED") return; // Do not post the bond.',
    'await postBond({ receiptId: receipt.receipt_id });',
  ].join("\n");
  return <div className="page secondary-page api-page"><p className="eyebrow">For proposers / For agents</p><h1>Read the action.<br />Before the bond.</h1><p className="page-intro">The action is authoritative. A SERV approval alone is not permission to proceed: the rule reading needs deterministic corroboration, and independent review can hold it.</p>
    <section className="panel live-api-docs"><h2>GET /api/live · live timing desk</h2><p>A read-only snapshot of UMA proposals for known Polymarket requesters still in their challenge window; live-only pagination up to 800 rows across two deployments; totals expose truncation and per-deployment counts. No SERV call is triggered by this request. <code>generated_at</code>, <code>age_ms</code>, <code>stale</code> and <code>enabled</code> describe freshness and collection state. Before the first successful cycle, totals and generation time are null and items is empty.</p>
      <h3>Totals</h3><p><code>in_liveness</code>, <code>screened</code>, <code>too_early_by_code</code>, <code>within_feed_lag</code>, <code>on_time_by_feed</code>, <code>passes_code</code>, <code>no_key</code>, <code>flagged</code>, <code>serv_read</code> and <code>serv_calls</code> are counts. <code>games</code> counts distinct feed events. <code>bond_in_liveness_usdc</code> sums known USDC bonds; <code>median_seconds_after_final</code> is the median nonnegative delay for evidence-confirmed on-time proposals, or null. <code>bond_at_risk_usdc</code> sums flagged USDC bonds; <code>bond_at_risk_complete</code> reports whether every flagged bond has a known USDC amount.</p>
      <h3>Proposal items</h3><p>Each item includes <code>proposal_id</code> (short and full), <code>request_id</code>, <code>title</code>, <code>proposed_outcome</code>, <code>sports_scope</code>, <code>sports_market_type</code>, <code>game</code> (title, score, period, ended, finished_utc), <code>seconds_after_final</code>, <code>screen</code>, <code>reason</code>, <code>needs</code>, <code>need_details</code>, <code>flag</code>, optional <code>action</code> and <code>receipt_id</code>, <code>proposal_time_utc</code>, <code>liveness_ends_utc</code>, nullable <code>bond_usdc</code>, <code>instants</code>, <code>uma_url</code>, optional <code>polymarket_url</code> and nullable <code>tx_hash</code>.</p><p>The screen is a timing screen; only a recorded action is a SERV-backed gate result. Flags need code or event evidence plus SERV agreement. Inside the 15-minute feed allowance, a later final mark proves neither timing outcome. Scope, screen, flag and action values are machine enums in JSON. Never treat a missing key as proof of premature timing.</p>
      <div className="code-grid"><div><h3>cURL</h3><pre><code>{`curl '${origin}/api/live'`}</code></pre></div><div><h3>Agent: list flags in six lines</h3><pre><code>{liveAgent}</code></pre></div></div><p><code>GET /api/live/history</code> returns rolling retained counts: <code>flagged</code>, <code>disputed</code>, <code>settled</code> and <code>pending</code>. Settled means a confirmed settlement without a recorded dispute; disappearance and expiry are not outcomes. Flags invite verification; the desk never recommends disputing. <code>GET /api/live/export/:proposal_id</code> returns one reviewer JSON bundle with rules, proposal IDs and transaction, instants, evidence, the first feed snapshot, screen, needs and any SERV receipt. URL-encode the full proposal ID.</p>
    </section>
    <section className="panel live-api-docs"><h2>Resolve, then check</h2><p><code>POST /api/market/resolve</code> accepts <code>{'{ "url": "https://polymarket.com/event/SLUG" }'}</code>. Pick a returned market ID and side, then call <code>POST /api/market/check</code>.</p><p>The check accepts <code>market_id</code>, <code>proposed_side</code> (Yes, No or a zero-based outcome index), and optional <code>check_time_utc</code>. Omit the time for now. Checks use the start of the selected UTC minute.</p><p>Rules come from Gamma’s current question and description. Unsupported market families need evidence without calling SERV. Responses include a saved receipt and the inputs used for the check.</p></section>
    <div className="endpoint"><span>POST</span><code>/api/market/check</code><span className="stamp">{procedure ? `${procedure} / ` : ""}three checks</span></div>
    <section className="code-grid"><div><h2>cURL</h2><pre><code>{curl}</code></pre></div><div><h2>Agent: six lines</h2><pre><code>{agent}</code></pre></div></section>
    <section className="panel api-fields"><h2>Fields an agent should use</h2><dl>
      <dt><code>action</code></dt><dd>Proceed, Wait, Need evidence or Held for independent review. Use this field to decide whether to post the bond; do not infer an action from the model’s verdict.</dd>
      <dt><code>earliest_utc</code></dt><dd>When a known cutoff causes a wait, the earliest UTC time to check again. It does not promise the next check will pass.</dd>
      <dt><code>evidence</code></dt><dd>Raw source facts: sports completion, score and period from the Polymarket sports feed, or Binance 1m candle scan coverage and first touch. This can include facts later than the selected proposal time.</dd>
      <dt><code>evidence_as_of_proposal</code></dt><dd>The time-filtered evidence the gate and SERV may use. A future finish or touch is withheld; a negative fact can block a too-early proposal.</dd>
      <dt><code>verdict.decisive_local</code></dt><dd>The date, time, timezone and minute adjustment SERV read from the governing clause. The app computes UTC from this clock; <code>gate.serv_clock_corrected</code> records a correction to the model’s own UTC.</dd>
      <dt><code>receipt</code></dt><dd>The saved action, procedure, gate, evidence and fingerprint. After a Reppo hold, original and held gate decisions remain in the receipt.</dd>
    </dl></section>
    <section className="method"><h2>Independent review and saved checks</h2><p><code>POST /api/second-opinion</code> accepts a receipt ID; <code>GET /api/second-opinion/:eval_id</code> returns review progress and the current action. A block, rejection, or review score below 70 can hold a previously approved action. Reppo never upgrades an action.</p><p><code>POST /api/check</code> re-checks a historical <code>case_id</code> with an optional <code>proposal_time_utc</code>. Cache identity includes the proposal time, model, procedure, gate and evidence. A locally dragged timeline does not create a new SERV reading or receipt.</p></section>
    {REPOSITORY && <p><a href={REPOSITORY} target="_blank" rel="noreferrer">ChallengeLens source on GitHub ↗</a></p>}
  </div>;
}
