import type { CaseLabel } from "../packets/types.js";
export interface Interval { count: number; total: number; low: number | null; high: number | null }
export function wilson(count: number, total: number): Interval {
  if (!Number.isInteger(count) || !Number.isInteger(total) || total < 0 || count < 0 || count > total) throw new Error("Invalid binomial count");
  if (!total) return { count, total, low: null, high: null };
  const z = 1.959963984540054; const z2 = z * z; const p = count / total;
  const center = (p + z2 / (2 * total)) / (1 + z2 / total);
  const margin = z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / (1 + z2 / total);
  return { count, total, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
export interface ActionMetrics {
  "Proceed precision": { count: number; total: number; case_interval: Interval };
  "Proceed coverage": Interval;
  "Safe on too-early": Interval;
}
/** Precision is a trial ratio; its Wilson interval uses case-majority units. Missing majorities never count as safe. */
export function actionMetrics(inputs: { case_id: string }[], rows: { case_id: string; action: string | null }[], labels: Map<string, CaseLabel>): ActionMetrics {
  const proceed = rows.filter((r) => r.action === "PROCEED");
  let proceeded = 0; let correctProceed = 0; let safe = 0; let ok = 0; let early = 0;
  for (const input of inputs) {
    const label = labels.get(input.case_id)!; const own = rows.filter((r) => r.case_id === input.case_id);
    const counts = new Map<string, number>();
    for (const r of own) if (r.action) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    const majority = [...counts].find(([, count]) => count >= 2)?.[0];
    if (label.label === "TIMING_OK") ok++; else early++;
    if (majority === "PROCEED") { proceeded++; if (label.label === "TIMING_OK") correctProceed++; }
    if (label.label === "PREMATURE" && majority && majority !== "PROCEED") safe++;
  }
  return { "Proceed precision": { count: proceed.filter((r) => labels.get(r.case_id)!.label === "TIMING_OK").length, total: proceed.length, case_interval: wilson(correctProceed, proceeded) },
    "Proceed coverage": wilson(correctProceed, ok), "Safe on too-early": wilson(safe, early) };
}
export function actionMarkdown(metrics: ActionMetrics): string {
  const show = (x: Interval) => `${x.count}/${x.total}; Wilson 95% ${x.low === null ? "n/a" : `${(100 * x.low).toFixed(1)}–${(100 * x.high!).toFixed(1)}%`}`;
  const p = metrics["Proceed precision"];
  return `| Proceed precision | ${p.count}/${p.total} trials; case-majority ${show(p.case_interval)} |\n| Proceed coverage | ${show(metrics["Proceed coverage"])} |\n| Safe on too-early | ${show(metrics["Safe on too-early"])} |`;
}
