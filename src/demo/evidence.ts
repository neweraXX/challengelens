import { asOf } from "../evidence/as-of.js";
import { evaluateGate } from "../gate/decide.js";
import { reviewPolicy } from "../reppo/policy.js";
import type { Evidence } from "../evidence/as-of.js";
import type { ShowcaseCase, SealedEvidence, BenchmarkModel, BenchmarkRowName } from "./types.js";

export function humanDecision(decision: string): string {
  return ({ SUPPORTED_NOW: "Approved", NOT_SUPPORTED_NOW: "Blocked: too early", INSUFFICIENT_EVIDENCE: "Held: needs evidence" } as Record<string, string>)[decision] ?? "Needs review";
}

export function humanizeDecisions(text: string): string {
  return text.replace(/\b(?:PROCEED|WAIT|NEED_EVIDENCE|HOLD_FOR_REVIEW)\b/gu, (value) => humanAction(value)).replace(/\b(?:SUPPORTED_NOW|NOT_SUPPORTED_NOW|INSUFFICIENT_EVIDENCE)\b/gu, humanDecision).replace(/\bPREMATURE\b/gu, "too early");
}

export const armNames: Record<BenchmarkRowName, string> = {
  "checks-only": "Checks only (no model)", raw: "Model only", serv: "SERV", "raw+gate": "Model + deterministic checks", "serv+gate": "SERV + deterministic checks",
};
export const armOrder = Object.keys(armNames) as BenchmarkRowName[];

/** Merge complementary arms, never sum repetitions from different runs.
 * The caller's first available arm wins when a later run repeats it. */
export function groupBenchmarkModels(models: BenchmarkModel[]): (BenchmarkModel & { runs: string[] })[] {
  const groups = new Map<string, BenchmarkModel & { runs: string[] }>();
  for (const model of models) {
    const key = JSON.stringify([model.model, model.procedure]);
    let group = groups.get(key);
    if (!group) { group = { ...model, rows: { ...model.rows }, runs: [] }; groups.set(key, group); }
    if (!group.runs.includes(model.run)) group.runs.push(model.run);
    for (const arm of armOrder) group.rows[arm] ??= model.rows[arm] ?? null;
  }
  return [...groups.values()];
}

/** Disjoint chart buckets: a correct abstention counts as correct. */
export function outcomeBuckets(metric: import("./types.js").BenchmarkArm) {
  const correct = metric.correct;
  const abstained = Math.max(0, metric.abstained - (metric.correct_abstained ?? 0));
  const dangerous = metric.false_supported;
  return { correct, abstained, safe: Math.max(0, metric.valid - correct - abstained - dangerous), dangerous, unscored: metric.trials - metric.valid };
}

export type Action = import("../gate/decide.js").GateDecision["action"];
export function humanAction(action: string, earliest?: string): string {
  if (action === "WAIT" && earliest && Number.isFinite(Date.parse(earliest))) {
    const clock = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(earliest));
    return `Wait until ${clock} UTC`;
  }
  return ({ PROCEED: "Proceed", WAIT: "Wait", NEED_EVIDENCE: "Need evidence", HOLD_FOR_REVIEW: "Held for independent review" } as Record<string, string>)[action] ?? "Need evidence";
}

/** Recompute the as-of view, never carry an old positive fact across a drag. */
export function inputsAt(item: ShowcaseCase, proposal: string, evidence: Evidence | null | undefined = item.evidence ?? item.receipt?.evidence) {
  const { evidence_as_of_proposal: saved, ...inputs } = item.model_inputs;
  const view = evidence ? asOf(evidence, proposal, inputs.rules_text) : proposal === item.proposal_time_utc ? saved : undefined;
  return { ...inputs, proposal_time_utc: proposal, ...(view ? { evidence_as_of_proposal: view } : {}) };
}
export function caseAction(item: ShowcaseCase): Action {
  const receipt = item.receipt;
  const result = evaluateGate(inputsAt(item, item.proposal_time_utc), item.verdict);
  return reviewPolicy(receipt?.final_decision ?? item.final_decision ?? result.final_decision, receipt?.reppo,
    receipt?.action ?? item.action ?? result.action).action;
}
/** Prefer a Braves replay with a real finish, then crypto; only choose a case
 * with a deterministic path to green. No IDs or dates are baked into the UI. */
export function selectFlagship(cases: ShowcaseCase[]): ShowcaseCase | undefined {
  const eligible = cases.filter((item) => {
    if (item.serv_called === false) return false;
    const gate = evaluateGate(inputsAt(item, item.proposal_time_utc), item.verdict).gate;
    const evidence = item.evidence ?? item.receipt?.evidence;
    if (gate.template === "sports") return Boolean(item.game_finished_utc || evidence?.kind === "sports_feed" && evidence.finished_utc);
    return Boolean(item.first_touch_utc || evidence?.kind === "price_touch" && evidence.first_touch_utc || gate.code_cutoff_utc);
  });
  return eligible.find((item) => /\bBraves\b/iu.test(item.title))
    ?? eligible.find((item) => item.category === "crypto_fixed_time") ?? eligible[0];
}

/** Legacy object is the original blind baseline. Explicit false stays false. */
export function sealedRuns(value: SealedEvidence | SealedEvidence[] | null | undefined): SealedEvidence[] {
  return (Array.isArray(value) ? value : value ? [value] : []).map((run) => ({ ...run, blind: run.blind ?? true }))
    .sort((a, b) => Number(b.blind) - Number(a.blind) || a.date.localeCompare(b.date));
}
export function eventMarker(item: ShowcaseCase): { time: string; label: string } | null {
  const evidence = item.evidence ?? item.receipt?.evidence;
  const finished = item.game_finished_utc ?? (evidence?.kind === "sports_feed" ? evidence.finished_utc : null);
  const touched = item.first_touch_utc ?? (evidence?.kind === "price_touch" ? evidence.first_touch_utc : null);
  if (finished && Number.isFinite(Date.parse(finished))) return { time: finished, label: "Game finished (Polymarket sports feed)" };
  if (touched && Number.isFinite(Date.parse(touched))) return { time: touched, label: "First touch (Binance 1m candle)" };
  return null;
}
