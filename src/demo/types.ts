import type { Verdict } from "../judge/schema.js";
import type { CasePacket, ModelInputs } from "../packets/types.js";

import type { GateDecision } from "../gate/decide.js";
import type { LivePacket } from "./live.js";
import type { Receipt } from "../gate/receipt.js";

/** Gate fields are optional only for previously generated public artifacts. */
export interface ShowcaseCase extends Partial<GateDecision> {
  game_finished_utc?: string | null;
  game_finished_source?: string;
  first_touch_utc?: string | null;
  first_touch_source?: string;
  receipt?: Receipt;
  source?: "gamma_live" | "uma_live_proposal";
  live_packet?: LivePacket;
  cached?: boolean;
  serv_called?: boolean;
  case_id: string;
  packet_hash: string;
  event_group: string;
  title: string;
  category: CasePacket["category"];
  fixed_time_kind: string;
  rules_text: string;
  proposal_time_utc: string;
  dispute_time_utc: string | null;
  settlement_time_utc: string | null;
  settlement_label: "TOO_EARLY" | "upheld" | "flipped" | null;
  settlement_value: string | null;
  settlement_tx_hash: string | null;
  bond: string | null;
  reward: string | null;
  currency: string | null;
  request_id: string;
  proposal_tx_hash: string | null;
  gamma_scheduling: ModelInputs["gamma_scheduling"];
  model_inputs: ModelInputs;
  verdict: Verdict;
  clause_offsets: { start: number; end: number };
  raw_verdict: Verdict | null;
  raw_run: string | null;
  rules_time_utc: string | null;
  gamma_time_utc: string | null;
  early_needs_evidence: boolean;
}

export type Outcome = "TOO_EARLY" | "upheld" | "flipped" | "50-50" | "other";
export interface Stats {
  total: number;
  outcomes: Record<Outcome, number>;
  by_year: Record<string, Record<Outcome, number>>;
  scope: string;
}

export interface BenchmarkArm {
  action_metrics?: import("../gate/metrics.js").ActionMetrics;
  trials: number;
  valid: number;
  false_supported: number;
  premature_trials: number;
  correct: number;
  correct_abstained?: number;
  abstained: number;
  consistent_cases: number;
  cases: number;
  cost_usd: number | null;
  tokens: number;
}
export interface Benchmark {
  label: string;
  run: string;
  date: string;
  procedure: string;
  arms: { raw: BenchmarkArm | null; serv: BenchmarkArm | null };
  sealed: "pending";
  source: string;
}

export type BenchmarkRowName = "raw" | "serv" | "raw+gate" | "serv+gate" | "checks-only";
export interface BenchmarkModel { model: string; run: string; procedure: string; source: string; serv_changes?: import("../gate/eval.js").ServChanges; rows: Record<Exclude<BenchmarkRowName, "checks-only">, BenchmarkArm | null> & { "checks-only"?: BenchmarkArm | null } }
export interface MultiBenchmark { label: string; sealed: "pending"; models: BenchmarkModel[]; procedure_version?: string }

export interface IntervalCount { count: number; total: number; low: number | null; high: number | null }
export interface SealedEvidence {
  split?: "sealed" | "sealed2";
  serv_changes?: import("../gate/eval.js").ServChanges;
  calls?: { planned: number; completed: number; invalid_raw: number; invalid_serv: number };
  blind?: boolean;
  note?: string;
  procedure_version: string;
  procedure_sha256: string;
  gate_version: string;
  models: Record<string, string>;
  date: string;
  status: string;
  unit: string;
  arms: { action_metrics?: import("../gate/metrics.js").ActionMetrics; arm: BenchmarkRowName; correct: IntervalCount; false_approvals: IntervalCount; abstentions: IntervalCount; consistency: IntervalCount;
    tokens: number; recorded_cost_usd: number; cost_complete: boolean; cost_attempts: number; attempts: number; completed_cases: number; cases: number }[];
}
