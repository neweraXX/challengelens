import type { GateDecision } from "../../src/gate/decide";
import type { Verdict } from "../../src/judge/schema";
import type { Receipt } from "../../src/gate/receipt";
import { humanAction, humanizeDecisions } from "../../src/demo/evidence";
import { readableExplanation } from "./timeline-utils";
import { ReppoReview } from "./ReppoReview";
import { describeNeeds } from "../../src/gate/needs";
import { humanGateReason, humanScope } from "./live-utils";
import { actionIcon, actionLabel, friendlyTime, timingAnswer } from "./TimingStatus";

export type CheckState = "pass" | "fail" | "unavailable";
function CheckIcon({ state }: { state: CheckState }) { return <span className={`check-icon check-${state}`} aria-hidden="true">{state === "pass" ? "✓" : state === "fail" ? "◷" : "−"}</span>; }
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
  const displayAction = simulated && action === "PROCEED" ? "NEED_EVIDENCE" : action;
  const heading = localPass ? "The timing checks pass. Ask SERV to confirm" : timingAnswer(displayAction, result.earliest_utc);
  const reason = action === "HOLD_FOR_REVIEW" ? "Independent review withheld the saved approval; review its reason below." : localPass ? "The deterministic checks support this time; re-check the rule with SERV before posting the bond." : readableExplanation(humanizeDecisions(humanGateReason(result.gate.gate_reason)));
  const servTime = Date.parse(result.gate.serv_decisive_time_utc ?? "");
  const servState: CheckState = simulated || !servCalled ? "unavailable" : source.decision === "NOT_SUPPORTED_NOW" || servTime > time ? "fail" : source.decision === "SUPPORTED_NOW" && Number.isFinite(servTime) ? "pass" : "unavailable";
  const local = source.decisive_local;
  const rawEvidence = receipt?.evidence ?? result.evidence;
  const quote = source.checks.timing.clause_quote;
  const needs = result.need_details?.length ? result.need_details : describeNeeds(result.needs, result.earliest_utc);
  const checklist = simulated && !needs.length ? describeNeeds(["NEED_SERV_APPROVAL"]) : needs;
  const servSummary = servState === "pass" ? "SERV reads the rule as supported at this time." : servState === "fail" ? "SERV reads this proposal as too early." : simulated ? "The saved reading needs a fresh check at this time." : "A current SERV rule reading is still needed.";
  const codeSummary = code === "pass" ? "The rule's cutoff has passed." : code === "fail" ? "The rule's cutoff has not passed." : result.gate.template === "sports" ? "A scheduled game time cannot prove it has finished." : "No supported clock is available for this rule.";
  const evidenceSummary = evidence === "pass" ? "The recorded facts support this proposal time." : evidence === "fail" ? "The recorded facts do not support this proposal time." : "More real-world evidence is needed.";
  return <aside className="verdict-card action-card" data-action={displayAction} aria-labelledby="verdict-title">
    <div className="verdict-header">
      <div className="action-source"><p className="eyebrow">Timing at this proposal</p><span className="source-tag">{sourceTag}</span></div>
      <div className="verdict-answer"><span className="answer-icon" aria-hidden="true">{actionIcon(displayAction)}</span><div>
        {displayAction === "PROCEED" ? <h3 className="action-label">Proceed</h3> : <span className="action-label" title={humanAction(action)}>{actionLabel(displayAction)}</span>}
        <h2 id="verdict-title" title={`${action}: ${humanAction(action, result.earliest_utc)}`} aria-live="polite" aria-atomic="true">{heading}</h2>
      </div></div>
      <p className="action-reason">{reason.charAt(0).toUpperCase() + reason.slice(1)}{reason.endsWith(".") ? "" : "."}</p>
      {displayAction === "NEED_EVIDENCE" && checklist.length > 0 && <div className="proceed-needs"><h3>To proceed, confirm:</h3><ul>{checklist.map((need, index) => <li key={`${need.code}-${index}`}><span aria-hidden="true">○</span><span>{readableExplanation(humanizeDecisions(need.text))}</span></li>)}</ul></div>}
      {action === "WAIT" && <p className="proceed-earliest"><strong>Earliest: </strong>{result.earliest_utc ? <time dateTime={result.earliest_utc}>{friendlyTime(result.earliest_utc)}</time> : "Not established; confirm the governing event has finished."}</p>}
      <p className="timing-scope">Timing only, not outcome.</p>
    </div>
    <div className="verdict-body">
      <h3>Three checks</h3><p className="checks-subtitle">Each check below says what it found.</p>
      <ol className="three-checks">
        <li><details><summary><CheckIcon state={servState} /><span><strong title="SERV rule reading">Rule reading (SERV AI)</strong><span className="check-sentence">{servSummary}</span></span></summary>
          <blockquote className="governing-excerpt" title={quote}>{quote ? `“${humanizeDecisions(quote)}”` : "No governing clause was returned."}</blockquote>
          <p className="check-value">{local?.date && local.time && local.timezone ? <>{local.date} {local.time} {local.timezone}{local.adjust_minutes ? ` (${local.adjust_minutes > 0 ? "+" : ""}${local.adjust_minutes} min)` : ""} → </> : "UTC reading: "}{result.gate.serv_decisive_time_utc ?? "Not established"}{simulated ? " · saved reading" : ""}</p>
          {result.gate.serv_clock_corrected && <p className="clock-corrected">Clock corrected from the stated local time.</p>}
        </details></li>
        <li><details><summary><CheckIcon state={code} /><span><strong>Clock (computed in code)</strong><span className="check-sentence">{codeSummary}</span><small className="check-technical-label">Code cutoff</small></span></summary><p className="check-value">{result.gate.template === "sports" ? "A scheduled or estimated game end cannot prove completion." : result.gate.code_cutoff_utc ?? "No supported cutoff template."}</p></details></li>
        <li><details><summary><CheckIcon state={evidence} /><span><strong title="Evidence">Real-world facts</strong><span className="check-sentence">{evidenceSummary}</span><small className="check-technical-label">{result.gate.template === "sports" ? "Sports feed" : "Price candles / event evidence"}</small></span></summary>
          {(result.gate.template === "sports" || result.gate.sports_scope) && <p className="check-value"><strong>{humanScope(result.gate.sports_scope ?? "UNKNOWN")}</strong></p>}
          <p className="check-value">{view ? "game_finished" in view ? <><strong>Polymarket sports feed</strong> · {view.game_finished ? `Game finished at ${view.finished_utc}` : "Game had not finished"}{view.game_finished && rawEvidence?.kind === "sports_feed" && (rawEvidence.score || rawEvidence.period) ? ` · feed snapshot: ${[rawEvidence.score, rawEvidence.period].filter(Boolean).join(" / ")}` : ""}</> : <><strong>Binance 1m candles</strong> · {view.event_occurred ? `First touch candle closed at ${view.first_observed_utc}` : `Price had not touched the target through ${view.scanned_until_utc}`}</> : "No usable evidence for this proposal time."}</p><p className="check-asof">Evidence as of {new Date(time).toISOString()}</p>
        </details></li>
      </ol>
      <button className="button primary check-button" disabled={busy || !servCalled} onClick={recheck}>{busy ? "SERV is checking…" : simulated ? "Get a fresh SERV reading ↗" : "Re-check with SERV at this time ↗"}</button>{message && <p className="small check-message" role="status">{humanizeDecisions(message)}</p>}
      {receipt && <details className="raw-explanation receipt-details"><summary>Saved receipt{simulated ? " · original time" : ""}</summary><p>{receipt.procedure_version} / {receipt.gate_version} · {receipt.proposal_time_utc}</p><p>Original action: {humanAction(receipt.original_gate_decision?.action ?? receipt.action)}{receipt.held_gate_decision && <> → Current action: {humanAction(receipt.held_gate_decision.action)}</>}</p><code>{receipt.receipt_sha256}</code><p><a href={`/api/receipts/${receipt.receipt_id}`} target="_blank" rel="noreferrer">View receipt JSON ↗</a></p></details>}
    </div>
    <ReppoReview key={receipt?.receipt_id ?? "no-receipt"} receipt={receipt} enabled={reviewMatches} prominent={action === "HOLD_FOR_REVIEW" || action === "NEED_EVIDENCE"} onReceipt={onReceipt} />
  </aside>;
}
