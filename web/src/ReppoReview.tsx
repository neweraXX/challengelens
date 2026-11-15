import { useEffect, useState } from "react";
import type { Receipt } from "../../src/gate/receipt";
import type { ReviewJob } from "../../src/reppo/service";
import "./ReppoReview.css";
import { reviewPolicy } from "../../src/reppo/policy";
import { humanAction, humanizeDecisions } from "../../src/demo/evidence";

function rubrics(value: unknown): { name: string; score: number; max: number; assumed: boolean }[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const score = typeof item === "number" ? item : row?.score;
    const maximum = row?.max_score ?? row?.maxScore ?? row?.max;
    if (typeof score !== "number" || !Number.isFinite(score)) return [];
    return [{ name: String(row?.name ?? row?.criterion ?? key), score, max: typeof maximum === "number" && maximum > 0 ? maximum : 100, assumed: typeof maximum !== "number" }];
  });
}
export function ReppoReview({ receipt, enabled, prominent, onReceipt }: { receipt: Receipt | undefined; enabled: boolean; prominent: boolean; onReceipt: (receipt: Receipt) => void }) {
  const [id, setId] = useState(receipt?.reppo?.eval_id ?? "");
  const [job, setJob] = useState<ReviewJob | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now()); const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!receipt) return;
    const controller = new AbortController();
    fetch(`/api/receipts/${receipt.receipt_id}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const current = await response.json() as Receipt;
      if (controller.signal.aborted) return;
      onReceipt(current); if (current.reppo) setId(current.reppo.eval_id);
    }).catch(() => {});
    return () => controller.abort();
  }, [receipt?.receipt_id, onReceipt]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let clock: ReturnType<typeof setInterval>; let ended = false;
    async function poll() {
      try {
        const response = await fetch(`/api/second-opinion/${encodeURIComponent(id)}`, { signal: controller.signal });
        const value = await response.json() as ReviewJob & { error?: string; receipt?: Receipt };
        if (!response.ok) throw new Error(value.error ?? "Reppo status is unavailable.");
        if (controller.signal.aborted) return;
        setJob(value); setError(""); if (value.receipt) onReceipt(value.receipt);
        ended = value.status === "COMPLETED" || value.status === "FAILED" || Boolean(value.polling_timed_out);
      } catch (reason) { if (controller.signal.aborted) return; setError(reason instanceof Error ? reason.message : "Status is unavailable."); ended = true; }
      if (!ended && !controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      else clearInterval(clock);
    }
    clock = setInterval(() => setNow(Date.now()), 1000); void poll();
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, [id, refresh, onReceipt]);
  async function ask() {
    if (!receipt || !enabled) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/second-opinion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt_id: receipt.receipt_id }) });
      const value = await response.json() as ReviewJob & { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Reppo could not queue the review.");
      setId(value.eval_id); setJob(value); setRefresh((n) => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Independent review failed."); }
    finally { setBusy(false); }
  }
  const evaluation = job?.evaluation; const result = evaluation?.result;
  const scores = rubrics(result?.rubric_scores);
  const pending = id && (!job || job.status === "QUEUED" || job.status === "PROCESSING") && !job?.polling_timed_out;
  const elapsed = job?.created_at ? Math.max(0, Math.floor((now - Date.parse(job.created_at)) / 1000)) : 0;
  const summary = receipt?.reppo ?? (evaluation?.status === "COMPLETED" && result ? { route: evaluation.route ?? "review", decision: result.decision, score: evaluation.score, reason: result.reason } : null);
  const original = receipt?.original_gate_decision?.action ?? receipt?.action ?? "NEED_EVIDENCE";
  const consequence = summary ? reviewPolicy(receipt?.original_gate_decision?.final_decision ?? receipt?.final_decision ?? "INSUFFICIENT_EVIDENCE", summary, original) : null;
  return <section className={`reppo-review${prominent ? " reppo-prominent" : ""}`} aria-label="Second opinion from Reppo">
    <h3>Second opinion (Reppo)</h3>{receipt && <p className="small muted">Reviews the saved receipt at {receipt.proposal_time_utc} ({receipt.gate_version}). Locally recomputed times need their own receipt.</p>}<p className="small">Reppo can only make the verdict more cautious. It never upgrades a too-early proposal or missing evidence to an approval and never supplies missing facts.</p>
    {prominent && !id && <p className="reppo-offer">Independent review is recommended: the rule reading, code cutoff or evidence needs another look.</p>}
    {!id && <><button type="button" className="button check-button" disabled={!enabled || busy} onClick={() => void ask()}>{busy ? "Queuing Reppo review…" : "Ask Reppo's evaluator panel"}</button><p className="small muted">440 credits for a new evaluation; this receipt is submitted once. Typically 30–90 seconds.</p></>}
    {!enabled && <p className="small muted">Run a check at this selected time to create a current receipt before asking Reppo.</p>}
    {pending && <p role="status">{job?.status === "PROCESSING" ? "Reviewing" : "Queued"} · {elapsed}s elapsed</p>}
    {job?.polling_timed_out && job.status !== "COMPLETED" && job.status !== "FAILED" && <p role="status">{job.error ?? "Polling stopped after the time limit. Refresh this evaluation; it will not be submitted again."}</p>}
    {job?.status === "FAILED" && <p role="status">Reppo evaluation failed. The original timing decision remains in force.</p>}
    {summary && <div className="reppo-consequence" role="status"><strong>{typeof summary.score === "number" ? `${summary.score}/100` : "Score unavailable"} · {summary.route === "ship" ? "No objection" : summary.route === "block" ? "Approval blocked" : "Review requested"}</strong><p>{consequence?.held ? `Reppo asked for review${typeof summary.score === "number" ? ` (score ${summary.score})` : ""}: action is now Held for independent review.` : `Reppo ${summary.route === "ship" ? "did not object" : "returned its review"}: action stays ${humanAction(original)}.`}</p><p>{humanizeDecisions(summary.reason)}</p></div>}
    {evaluation?.status === "COMPLETED" && result && <div className="reppo-result"><div className="reppo-score"><strong>{evaluation.score}/100</strong><span className="stamp" data-route={evaluation.route}>{(evaluation.route ?? "review").replace(/_/gu, " ").toLowerCase()}</span><span>{String(result.confidence).toLowerCase()} confidence</span></div>
      <div className="reppo-rubrics">{scores.map((score) => <div key={score.name}><span>{humanizeDecisions(score.name)} · {score.score}/{score.max}</span><div className="reppo-track" role="meter" aria-label={score.name} aria-valuemin={0} aria-valuemax={score.max} aria-valuenow={Math.max(0, Math.min(score.max, score.score))}><i style={{ width: `${Math.max(0, Math.min(100, 100 * score.score / score.max))}%` }} /></div></div>)}</div>
      {scores.some((s) => s.assumed) && <p className="small muted">Rubrics without an explicit maximum use a 0–100 display scale.</p>}
      {!scores.length && <details><summary>Rubric scores</summary><pre>{humanizeDecisions(JSON.stringify(result.rubric_scores ?? null, null, 2))}</pre></details>}
    </div>}
    {id && <div className="reppo-id"><code>{id}</code><button type="button" className="text-button" onClick={() => { void navigator.clipboard.writeText(id).then(() => setCopied(true)).catch(() => setError("Copy unavailable. Select the evaluation ID to copy it.")); }}>{copied ? "Copied" : "Copy eval ID"}</button></div>}
    {error && <p role="alert" className="small">{error}</p>}
    {id && (error || (job?.polling_timed_out && job.status !== "COMPLETED" && job.status !== "FAILED")) && <button type="button" className="text-button" onClick={() => setRefresh((n) => n + 1)}>Refresh this evaluation</button>}
  </section>;
}
