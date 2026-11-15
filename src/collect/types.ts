// Keep the original fields; never convert prices to floating point numbers.
export interface OracleRequest {
  id: string;
  requester: string;
  identifier: string;
  time: string;
  ancillaryData: string;
  proposer: string | null;
  proposedPrice: string | null;
  disputer: string | null;
  state: string;
  requestTimestamp: string;
  requestBlockNumber: string;
  requestHash: string;
  requestLogIndex: string;
  proposalTimestamp: string | null;
  proposalBlockNumber: string | null;
  proposalHash: string | null;
  proposalLogIndex: string | null;
  proposalExpirationTimestamp: string | null;
  disputeTimestamp: string | null;
  disputeHash: string | null;
  settlementPrice: string | null;
  settlementTimestamp: string | null;
  settlementHash: string | null;
  currency: string;
  bond: string;
  finalFee: string;
  reward: string;
  customLiveness: string;
  eventBased: boolean;
  [field: string]: unknown;
}

export interface FrozenBlock {
  number: number;
  hash: string | null;
  hasIndexingErrors: boolean;
}

export type SampleKind = "disputed" | "undisputed_control";

export interface Sample {
  deployment: string;
  block: FrozenBlock;
  kind: SampleKind;
  cacheFile: string;
  raw: OracleRequest;
}

export interface SourceReport {
  deployment: string;
  block: FrozenBlock | null;
  disputed: number;
  controls: number;
  controlFilter: string;
  error: string | null;
}

export interface Ancillary {
  decodedText: string | null;
  utf8Valid: boolean;
  error: string | null;
  title: string | null;
  description: string | null;
  resolutionRules: string | null;
  extraction: "heuristic";
  questionIdHints: string[];
  marketIdHints: string[];
  hypothesizedQuestionId: string | null;
}

export type GammaMarket = Record<string, unknown>;

export interface GammaAttempt {
  lookup: "ancillary_keccak" | "question_id_hint" | "market_id_hint";
  url: string;
  cacheFile: string | null;
  returnedMarkets: number;
  exactMatches: number;
  error: string | null;
}

export interface GammaJoin {
  status: "joined" | "not_found" | "error" | "not_attempted";
  hashHypothesisJoined: boolean;
  attempts: GammaAttempt[];
  markets: GammaMarket[];
}

export interface Candidate {
  schemaVersion: "pilot-1";
  chainId: 137;
  deployment: string;
  frozenBlock: FrozenBlock;
  sampleKind: SampleKind;
  requestCacheFile: string;
  adapter: { address: string; label: string; verified: boolean };
  raw: OracleRequest;
  ancillary: Ancillary;
  gamma: GammaJoin;
  settlementDiffersFromProposal: boolean | null;
  identityVerifiedAgainstReceipts: false;
  controlDisputeAbsenceVerifiedAgainstLogs: false;
}
