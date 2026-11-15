import type { FixedTimeMatch } from "./fixed-time.js";

export type TimingLabel = "PREMATURE" | "TIMING_OK";
export type Category = "sports_in_game" | "crypto_fixed_time" | "fixed_window" | "deadline_no" | "politics_news" | "other";
export type Schedule = Record<string, string>;

export interface ModelInputs {
  evidence_as_of_proposal?: import("../evidence/as-of.js").EvidenceAsOf;
  title: string;
  rules_text: string;
  proposal_time_utc: string;
  proposed_value: "0" | "1000000000000000000";
  gamma_scheduling: {
    provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY";
    market: Schedule;
    events: Schedule[];
  };
}

export interface CasePacket {
  schema_version: "timing-packet-1";
  case_id: string;
  packet_hash: string;
  event_group: string;
  category: Category;
  fixed_time?: FixedTimeMatch;
  model_inputs: ModelInputs;
  provenance: {
    deployment: string;
    request_id: string;
    proposal_hash: string | null;
    proposal_log_index: string | null;
    identity_verified_against_receipts: boolean;
    historical_rule_updates_verified: false;
  };
}

// This object must never be included in a model message or packet hash.
export interface CaseLabel {
  case_id: string;
  packet_hash: string;
  label: TimingLabel;
  expected_decision: "NOT_SUPPORTED_NOW" | "SUPPORTED_NOW";
  expected_reason: "PREMATURE" | null;
  outcome_flipped: boolean;
  settlement_price: string;
  source: "ORACLE_SETTLEMENT_TIMING_PROXY";
  receipt_verified: boolean;
}

export interface LabeledCase {
  packet: CasePacket;
  label: CaseLabel;
}
