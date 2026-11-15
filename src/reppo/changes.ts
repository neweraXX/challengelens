export interface ProcedureChange {
  date: string; from_version: string; to_version: string; reppo_eval_ids: string[]; critique_summary: string; change: string;
  dev_before: unknown; dev_after: unknown; accepted: boolean;
}
export interface ReppoLoop { generated_at: string; changes: ProcedureChange[] }
export function procedureChange(value: unknown): ProcedureChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected a change record object");
  const v = value as Record<string, unknown>;
  if (!["from_version", "to_version", "critique_summary", "change"].every((k) => typeof v[k] === "string" && v[k].trim()) || !Array.isArray(v.reppo_eval_ids) || !v.reppo_eval_ids.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/u.test(id)) || typeof v.accepted !== "boolean" || !("dev_before" in v) || !("dev_after" in v)) throw new Error("Supply versions, evaluation IDs, critique, change, before/after metrics, and an explicit accepted boolean");
  const date = typeof v.date === "string" ? v.date : new Date().toISOString();
  if (!Number.isFinite(Date.parse(date))) throw new Error("Invalid change date");
  return { date, from_version: v.from_version as string, to_version: v.to_version as string, reppo_eval_ids: v.reppo_eval_ids as string[], critique_summary: v.critique_summary as string,
    change: v.change as string, dev_before: v.dev_before, dev_after: v.dev_after, accepted: v.accepted };
}
