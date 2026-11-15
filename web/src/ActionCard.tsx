import type { GateDecision } from "../../src/gate/decide";
import type { Verdict } from "../../src/judge/schema";
import type { Receipt } from "../../src/gate/receipt";
import { humanAction, humanizeDecisions } from "../../src/demo/evidence";
import { readableExplanation } from "./timeline-utils";
import { ReppoReview } from "./ReppoReview";
import { describeNeeds } from "../../src/gate/needs";
import { humanGateReason, humanScope } from "./live-utils";

export type CheckState = "pass" | "fail" | "unavailable";
function CheckChip({ state }: { state: CheckState }) { return <span className={`check-chip check-${state}`}>{state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Not available"}</span>; }
export function deterministicChecks(result: GateDecision, time: number) {
  const view = result.evidence_as_of_proposal ?? result.gate.evidence;
  const code: CheckState = result.gate.template === "sports" || !result.gate.code_cutoff_utc ? "unavailable" : Date.parse(result.gate.code_cutoff_utc) <= time ? "pass" : "fail";
  const evidence: CheckState = !view ? "unavailable" : ("game_finished" in view ? view.game_finished : view.event_occurred) ? "pass" : "fail";
  return { code, evidence, view };
}

export function ActionCard({ result, source, action, simulated, time, sourceTag, receipt, reviewMatches, busy, message, recheck, onReceipt, servCalled }: {
  result: GateDecision; source: Verdict; action: GateDecision["action"]; simulated: boolean; time: number; sourceTag: string;
  receipt?: Receipt; reviewMatches: boolean; busy: boolean; message: string; recheck: () => void; onReceipt: (receipt: Receipt) => void; servCalled: boolean;
}) {
  const { code, evidence, view } = deterministicChecks(result, time);
  const localPass = simulated && result.action !== "WAIT" && action !== "HOLD_FOR_REVIEW" && (code === "pass" || evidence === "pass");
  const heading = localPass ? `${code === "pass" && evidence === "pass" ? "Code and evidence pass" : evidence === "pass" ? "Evidence passes" : "Code cutoff passes"} · needs a fresh SERV reading` : humanAction(action, result.earliest_utc);
  const reason = action === "HOLD_FOR_REVIEW" ? "Independent review withheld the saved approval; review its reason below." : localPass ? "The deterministic checks support this time; re-check the rule with SERV before posting the bond." : readableExplanation(humanizeDecisions(humanGateReason(result.gate.gate_reason)));
  const servTime = Date.parse(result.gate.serv_decisive_time_utc ?? "");
  const servState: CheckState = simulated || !servCalled ? "unavailable" : source.decision === "NOT_SUPPORTED_NOW" || servTime > time ? "fail" : source.decision === "SUPPORTED_NOW" && Number.isFinite(servTime) ? "pass" : "unavailable";
  const local = source.decisive_local;
  const rawEvidence = receipt?.evidence ?? result.evidence;
  const quote = source.checks.timing.clause_quote;
  const needs = result.need_details?.length ? result.need_details : describeNeeds(result.needs, result.earliest_utc);
  const checklist = simulated && !needs.length ? describeNeeds(["NEED_SERV_APPROVAL"]) : needs;
  return <aside className="verdict-card action-card" data-action={simulated && action === "PROCEED" ? "NEED_EVIDENCE" : action} aria-labelledby="verdict-title">
    <div className="action-source"><p className="eyebrow">Action at this time</p><span className="source-tag">{sourceTag}</span></div>
    <h2 id="verdict-title" aria-live="polite" aria-atomic="true">{heading}</h2><p className="action-reason">{reason.charAt(0).toUpperCase() + reason.slice(1)}{reason.endsWith(".") ? "" : "."}</p>
    {action === "NEED_EVIDENCE" && checklist.length > 0 && <div className="proceed-needs"><h3>To proceed, confirm:</h3><ul>{checklist.map((need, index) => <li key={`${need.code}-${index}`}><span aria-hidden="true">□</span><span>{readableExplanation(humanizeDecisions(need.text))}</span></li>)}</ul></div>}
    {action === "WAIT" && <p className="proceed-earliest"><strong>Earliest: </strong>{result.earliest_utc ? <time dateTime={result.earliest_utc}>{readableExplanation(result.earliest_utc)}</time> : "Not established; confirm the governing event has finished."}</p>}
    <h3>Three checks</h3><ol className="three-checks">
      <li><div className="check-row-heading"><strong>SERV rule reading</strong><CheckChip state={servState} /></div>
        <blockquote className="governing-excerpt" title={quote}>{quote ? `“${humanizeDecisions(quote)}”` : "No governing clause was returned."}</blockquote>
        <p className="check-value">{local?.date && local.time && local.timezone ? <>{local.date} {local.time} {local.timezone}{local.adjust_minutes ? ` (${local.adjust_minutes > 0 ? "+" : ""}${local.adjust_minutes} min)` : ""} → </> : "UTC reading: "}{result.gate.serv_decisive_time_utc ?? "Not established"}{simulated ? " · saved reading" : ""}</p>
        {result.gate.serv_clock_corrected && <p className="clock-corrected">Clock corrected from the stated local time.</p>}
      </li>
      <li><div className="check-row-heading"><strong>Code cutoff</strong><CheckChip state={code} /></div><p className="check-value">{result.gate.template === "sports" ? "A scheduled or estimated game end cannot prove completion." : result.gate.code_cutoff_utc ?? "No supported cutoff template."}</p></li>
      <li><div className="check-row-heading"><strong>Evidence</strong><CheckChip state={evidence} /></div>{(result.gate.template === "sports" || result.gate.sports_scope) && <p className="check-value"><strong>{humanScope(result.gate.sports_scope ?? "UNKNOWN")}</strong></p>}<p className="check-value">{view ? "game_finished" in view ? <><strong>Polymarket sports feed</strong> · {view.game_finished ? `Game finished at ${view.finished_utc}` : "Game had not finished"}{view.game_finished && rawEvidence?.kind === "sports_feed" && (rawEvidence.score || rawEvidence.period) ? ` · feed snapshot: ${[rawEvidence.score, rawEvidence.period].filter(Boolean).join(" / ")}` : ""}</> : <><strong>Binance 1m candles</strong> · {view.event_occurred ? `First touch candle closed at ${view.first_observed_utc}` : `Price had not touched the target through ${view.scanned_until_utc}`}</> : "No usable evidence for this proposal time."}</p><p className="check-asof">As of {new Date(time).toISOString()}</p></li>
    </ol>
    <button className="button primary check-button" disabled={busy || !servCalled} onClick={recheck}>{busy ? "SERV is checking…" : simulated ? "Get a fresh SERV reading ↗" : "Re-check with SERV at this time ↗"}</button>{message && <p className="small check-message" role="status">{humanizeDecisions(message)}</p>}
    {receipt && <details className="raw-explanation receipt-details"><summary>Saved receipt{simulated ? " · original time" : ""}</summary><p>{receipt.procedure_version} / {receipt.gate_version} · {receipt.proposal_time_utc}</p><p>Original action: {humanAction(receipt.original_gate_decision?.action ?? receipt.action)}{receipt.held_gate_decision && <> → Current action: {humanAction(receipt.held_gate_decision.action)}</>}</p><code>{receipt.receipt_sha256}</code><p><a href={`/api/receipts/${receipt.receipt_id}`} target="_blank" rel="noreferrer">View receipt JSON ↗</a></p></details>}
    <ReppoReview key={receipt?.receipt_id ?? "no-receipt"} receipt={receipt} enabled={reviewMatches} prominent={action === "HOLD_FOR_REVIEW" || action === "NEED_EVIDENCE"} onReceipt={onReceipt} />
  </aside>;
}
