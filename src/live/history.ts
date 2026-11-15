import type { OracleRequest } from "../collect/types.js";
import type { Snapshot } from "./desk.js";

export interface FlagHistory {
  proposal_id: string; request_id: string; deployment: string; proposal_time_utc: string; proposal_hash: string | null; proposal_log_index: string | null;
  first_flagged_at: string; last_checked_at?: string; liveness_ends_utc: string; outcome: "disputed" | "settled" | null; outcome_at: string | null;
}
export function recordFlags(history: FlagHistory[], snapshot: Snapshot, limit = 2000): FlagHistory[] {
  const byId = new Map(history.map((row) => [row.proposal_id, row]));
  for (const item of snapshot.items) if (item.flag === "LIKELY_TOO_EARLY" && !byId.has(item.proposal_id.full)) byId.set(item.proposal_id.full, {
    proposal_id: item.proposal_id.full, request_id: item.request_id, deployment: item.deployment, proposal_time_utc: item.proposal_time_utc,
    proposal_hash: item.tx_hash, proposal_log_index: item.proposal_log_index, first_flagged_at: snapshot.generated_at, liveness_ends_utc: item.liveness_ends_utc, outcome: null, outcome_at: null,
  });
  return [...byId.values()].sort((a, b) => a.first_flagged_at.localeCompare(b.first_flagged_at)).slice(-limit);
}
/** Disappearance and expiry are not outcomes. Reproposals must not inherit an earlier flag. */
export function updateHistory(history: FlagHistory[], outcomes: { deployment: string; raw: OracleRequest }[], checkedAt: string): FlagHistory[] {
  const byId = new Map(outcomes.map((r) => [`${r.deployment}:${r.raw.id}`, r.raw]));
  return history.map((h) => {
    if (h.outcome) return h;
    const row = byId.get(`${h.deployment}:${h.request_id}`);
    if (!row || Number(row.proposalTimestamp) * 1000 !== Date.parse(h.proposal_time_utc) || (h.proposal_hash && row.proposalHash !== h.proposal_hash) || h.proposal_log_index !== null && row.proposalLogIndex !== h.proposal_log_index) return h;
    const outcome = Number(row.disputeTimestamp) > 0 || row.state === "Disputed" ? "disputed" : row.state === "Settled" ? "settled" : null;
    return outcome ? { ...h, outcome, outcome_at: checkedAt } : h;
  });
}
export function historySummary(history: FlagHistory[]) {
  const disputed = history.filter((h) => h.outcome === "disputed").length;
  const settled = history.filter((h) => h.outcome === "settled").length;
  return { rolling: true, retained_limit: 2000, flagged: history.length, disputed, settled, pending: history.length - disputed - settled,
    disputed_of_resolved: { count: disputed, total: disputed + settled },
    wording: `flagged earlier, then disputed: ${disputed} of ${disputed + settled} with a confirmed onchain outcome` };
}
