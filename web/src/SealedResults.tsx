import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { IntervalCount, SealedEvidence } from "../../src/demo/types";
import { armNames, armOrder, humanizeDecisions, sealedRuns } from "../../src/demo/evidence";
import { GuardrailDemo } from "./GuardrailDemo";

const bucketNames: Record<string, string> = { correct: "Correct", abstained: "Abstained", safe: "Wrong but safe", dangerous: "Dangerous approval", unscored: "No majority" };
type Arm = SealedEvidence["arms"][number];
const intervalText = (metric: IntervalCount) => metric.low === null || metric.high === null ? "95% interval unavailable" : `Wilson 95% ${(100 * metric.low).toFixed(1)}–${(100 * metric.high).toFixed(1)}%`;
const count = (metric?: IntervalCount) => metric ? `${metric.count}/${metric.total}` : "—";
const finalArm = (run?: SealedEvidence) => run?.arms.find((arm) => arm.arm === "serv+gate") ?? run?.arms.find((arm) => arm.arm === "raw+gate") ?? run?.arms.find((arm) => arm.arm === "serv") ?? run?.arms[0];
function buckets(arm: Arm) {
  return { correct: arm.correct.count, abstained: arm.abstentions.count,
    safe: Math.max(0, arm.completed_cases - arm.correct.count - arm.abstentions.count - arm.false_approvals.count), dangerous: arm.false_approvals.count, unscored: arm.cases - arm.completed_cases };
}

export function HeldOutEvidence() {
  const [runs, setRuns] = useState<SealedEvidence[]>([]); const [status, setStatus] = useState("loading");
  useEffect(() => { const controller = new AbortController();
    fetch("/data/sealed.json", { signal: controller.signal }).then(async (response) => { if (response.status === 404) { setStatus("missing"); return; } if (!response.ok) throw new Error(); setRuns(sealedRuns(await response.json() as SealedEvidence | SealedEvidence[])); setStatus("ready"); }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, []);
  // Lead with the newest blind run: it measures the current procedure and gate.
  const blind = runs.filter((run) => run.blind).at(-1); const second = runs.filter((run) => !run.blind).at(-1);
  const baseline = finalArm(blind); const comparison = finalArm(second);
  // Hero contrast: the same blind run, SERV alone versus SERV plus the deterministic checks.
  const alone = blind?.arms.find((arm) => arm.arm === "serv");
  return <section className="held-out" aria-label="Held-out evidence">
    {baseline && <><div className="evidence-hero" aria-label="Blind baseline with labelled second-look comparison">{[
      ["Too-early proposals approved", alone?.false_approvals ?? baseline.false_approvals, alone ? baseline.false_approvals : undefined], ["Cases with the same answer three times", alone?.consistency ?? baseline.consistency, alone ? baseline.consistency : undefined], ["Held for evidence instead of guessing", baseline.abstentions, undefined],
    ].map(([label, before, after], index) => <div className={`evidence-stat${index === 0 ? " danger-stat" : ""}`} key={String(label)}><p>{String(label)}</p><strong>{count(before as IntervalCount)}{after && <><span> → </span>{count(after as IntervalCount)}</>}</strong><p>{after ? "SERV alone → SERV + deterministic checks" : "SERV + deterministic checks"}</p><small>Blind test · frozen before unblinding · case-majority counts</small></div>)}</div><GuardrailDemo runs={runs} /><p className="small muted">The blind baseline was frozen before its labels were opened. Any labelled second look uses evidence keys after unblinding; it is not a new blind test.</p></>}
    {!runs.length && <div className="sealed-evidence panel"><h2>{status === "missing" || status === "ready" ? "Sealed test: not run yet" : status === "error" ? "Sealed test: results unavailable" : "Loading held-out results…"}</h2><p>Development results below do not establish held-out performance.</p></div>}
    {[...runs].sort((a, b) => Number(b.split === "sealed2") - Number(a.split === "sealed2")).map((run) => <SealedRun key={`${run.procedure_sha256}:${run.date}`} run={run} />)}
  </section>;
}

function SealedRun({ run }: { run: SealedEvidence }) {
  const primary = finalArm(run);
  const actionMetrics = primary?.action_metrics;
  return <section className="sealed-evidence panel">
    <p className="eyebrow">{run.split === "sealed2" ? "Blind test · current version" : run.blind ? "Earlier blind test · older version" : "Post-unblinding measurement · older version"}</p><h2>{run.split === "sealed2" ? "Blind test on unseen cases (frozen before unblinding)" : run.blind ? "First blind test (frozen before unblinding)" : "Second look at the first set (not blind)"}</h2>
    <p className="small mono muted">{run.procedure_version} · {run.gate_version} · {new Date(run.date).toLocaleDateString("en-US", { timeZone: "UTC" })}</p>
    {run.note && <p className="second-look-note">{humanizeDecisions(run.note)}</p>}
    {run.calls && <p className="call-completion">{run.calls.completed} of {run.calls.planned} calls completed{run.calls.invalid_raw ? `; ${run.calls.invalid_raw} raw-model outputs were invalid` : ""}{run.calls.invalid_serv ? `; ${run.calls.invalid_serv} SERV outputs were invalid` : ""}.</p>}
    <div className="evidence-charts sealed-charts"><section><h3>Dangerous approvals on too-early proposals</h3><p className="small muted">One square per case with a decision majority. Amber means approved too early.</p>
      {armOrder.map((name) => { const arm = run.arms.find((row) => row.arm === name); return <div className="unit-row sealed-unit-row" key={name}><span>{armNames[name]}</span>{arm ? <><div className="unit-squares" style={{ "--unit-count": Math.max(1, arm.false_approvals.total) } as CSSProperties} role="img" aria-label={`${armNames[name]}: ${count(arm.false_approvals)} dangerous approvals`}>
        {Array.from({ length: arm.false_approvals.total }, (_, index) => <i key={index} className={index < arm.false_approvals.count ? "danger-fill" : ""} />)}</div><strong className="mono">{count(arm.false_approvals)}</strong><small className="chart-interval">{intervalText(arm.false_approvals)}</small></> : <span className="muted">Not run</span>}</div>; })}
    </section><section><h3>What happened to all cases</h3><p className="small muted">Each case is graded by its majority decision and reason. Missing majorities are shown separately.</p>
      {armOrder.map((name) => { const arm = run.arms.find((row) => row.arm === name); return <div className="stack-row sealed-stack-row" key={name}><span>{armNames[name]}</span>{arm ? <><div className="check-stack" role="img" aria-label={Object.entries(buckets(arm)).map(([key, value]) => `${bucketNames[key]}: ${value}`).join(", ")}>{Object.entries(buckets(arm)).map(([key, value]) => value > 0 && <span key={key} className={`bucket-${key}`} style={{ width: `${100 * value / arm.cases}%` }} title={`${bucketNames[key]}: ${value}`}>{value}</span>)}</div><span className="mono small">{arm.cases}</span><small className="chart-interval">Correct {count(arm.correct)} · {intervalText(arm.correct)}; abstained {count(arm.abstentions)} · {intervalText(arm.abstentions)}</small></> : <span className="muted">Not run</span>}</div>; })}
      <div className="chart-legend">{Object.entries(bucketNames).map(([key, name]) => <span key={key}><i className={`bucket-${key}`} />{name}</span>)}</div>
    </section></div>
    {!run.blind && actionMetrics && <section className="action-metrics" aria-label="Action metrics"><h3>{primary && armNames[primary.arm]} · action metrics</h3><div className="action-tiles">{Object.entries(actionMetrics).map(([name, metric]) => { const precision = "case_interval" in metric; const interval = precision ? metric.case_interval : metric; return <div className="action-tile" key={name}><p>{name}</p><strong>{metric.total ? `${(100 * metric.count / metric.total).toFixed(1)}%` : "—"}</strong><p>{metric.count}/{metric.total} {precision ? "Proceed trials" : "cases"}</p><small>{precision ? `Case-majority ${count(interval)} · ` : ""}{intervalText(interval)}</small></div>; })}</div><p className="small muted">Proceed precision uses a trial ratio; its interval uses case majorities. Coverage and safety include all cases in the relevant label group, including missing majorities.</p></section>}
    <details className="evidence-table"><summary>Exact case counts, intervals, actions, tokens and cost</summary><div className="table-scroll"><table><thead><tr><th>Arm</th><th>Correct</th><th>Abstained</th><th>Wrong but safe</th><th>Dangerous approval</th><th>Consistent</th><th>Majority coverage</th><th>Tokens</th><th>Recorded cost</th></tr></thead><tbody>{run.arms.map((arm) => <tr key={arm.arm}><th>{armNames[arm.arm]}</th><td>{count(arm.correct)}<small>{intervalText(arm.correct)}</small></td><td>{count(arm.abstentions)}<small>{intervalText(arm.abstentions)}</small></td><td>{buckets(arm).safe}</td><td>{count(arm.false_approvals)}<small>{intervalText(arm.false_approvals)}</small></td><td>{count(arm.consistency)}<small>{intervalText(arm.consistency)}</small></td><td>{arm.completed_cases}/{arm.cases}</td><td>{arm.tokens.toLocaleString()}</td><td>${arm.recorded_cost_usd.toFixed(4)}{arm.cost_complete ? "" : ` · partial (${arm.cost_attempts}/${arm.attempts} attempts)`}</td></tr>)}</tbody></table></div>
      {run.arms.filter((arm) => arm.action_metrics).map((arm) => <div className="table-scroll" key={arm.arm}><table><caption>{armNames[arm.arm]} · actions</caption><thead><tr><th>Measure</th><th>Ratio</th><th>Case-majority interval</th></tr></thead><tbody>{Object.entries(arm.action_metrics!).map(([name, metric]) => <tr key={name}><th>{name}</th><td>{metric.count}/{metric.total}{"case_interval" in metric ? " trials" : " cases"}</td><td>{intervalText("case_interval" in metric ? metric.case_interval : metric)}</td></tr>)}</tbody></table></div>)}
    </details><p className="small muted">Models: {Object.entries(run.models).map(([arm, model]) => `${armNames[arm as "raw" | "serv"]}: ${model}`).join(" · ")}. Wilson 95% intervals use cases, not independent repetitions. Consistency requires all three readings to match. Deterministic checks reuse the same saved model calls.</p>
  </section>;
}
