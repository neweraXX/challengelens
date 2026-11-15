import { mkdir, rename, writeFile } from "node:fs/promises";
import type { Candidate, Sample, SourceReport } from "./types.js";

function iso(value: string | null | undefined): string {
  if (!value || !/^\d+$/u.test(value)) return "unknown";
  const milliseconds = Number(value) * 1_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 8_640_000_000_000_000) return "unknown";
  return new Date(milliseconds).toISOString();
}

function year(sample: Sample): string {
  // Proposal year, falling back to the request event year. Neither is request.time.
  const proposal = iso(sample.raw.proposalTimestamp);
  const timestamp = proposal === "unknown" ? iso(sample.raw.requestTimestamp) : proposal;
  return timestamp === "unknown" ? "unknown" : timestamp.slice(0, 4);
}

function md(value: unknown): string {
  return String(value ?? "unknown").replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function csv(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Public ancillary/market text is untrusted. Avoid spreadsheet formula execution.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

export interface RequesterCount {
  requester: string;
  total: number;
  disputed: number;
  controls: number;
}

export function requesterCounts(samples: Sample[]): RequesterCount[] {
  const counts = new Map<string, RequesterCount>();
  for (const sample of samples) {
    const requester = sample.raw.requester.toLowerCase();
    const row = counts.get(requester) ?? { requester, total: 0, disputed: 0, controls: 0 };
    row.total += 1;
    if (sample.kind === "disputed") row.disputed += 1;
    else row.controls += 1;
    counts.set(requester, row);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total || a.requester.localeCompare(b.requester, "en"));
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
}

export async function writeReports(
  samples: Sample[],
  candidates: Candidate[],
  sources: SourceReport[],
  options: { offline: boolean; refresh: boolean },
): Promise<void> {
  await mkdir("data/pilot", { recursive: true });
  const jsonl = candidates.map((candidate) => JSON.stringify(candidate)).join("\n");
  await atomicWrite("data/pilot/candidates.jsonl", jsonl ? `${jsonl}\n` : "");

  const headers = [
    "deployment", "frozen_block", "frozen_block_hash", "sample_kind", "request_id", "requester",
    "adapter_verified", "identifier", "request_time", "request_event_time_utc",
    "title", "description", "resolution_rules", "decoded_ancillary", "ancillary_hex",
    "hypothesized_question_id", "question_id_hints", "market_id_hints", "utf8_valid", "decode_error",
    "proposal_time_utc", "proposed_value", "settlement_time_utc", "settlement_value", "dispute_time_utc",
    "settlement_differs_from_proposal", "proposal_hash", "proposal_block", "proposal_log_index",
    "gamma_status", "hash_hypothesis_joined", "gamma_market_ids", "gamma_question_ids", "gamma_titles",
    "gamma_attempts", "request_cache_file", "identity_verified_against_receipts",
    "control_dispute_absence_verified_against_logs",
  ];
  const rows = candidates.map((candidate) => {
    const raw = candidate.raw;
    return [
      candidate.deployment, candidate.frozenBlock.number, candidate.frozenBlock.hash,
      candidate.sampleKind, raw.id, raw.requester, candidate.adapter.verified,
      raw.identifier, raw.time, iso(raw.requestTimestamp), candidate.ancillary.title,
      candidate.ancillary.description, candidate.ancillary.resolutionRules,
      candidate.ancillary.decodedText, raw.ancillaryData, candidate.ancillary.hypothesizedQuestionId,
      candidate.ancillary.questionIdHints.join(";"), candidate.ancillary.marketIdHints.join(";"),
      candidate.ancillary.utf8Valid, candidate.ancillary.error,
      iso(raw.proposalTimestamp), raw.proposedPrice, iso(raw.settlementTimestamp), raw.settlementPrice,
      iso(raw.disputeTimestamp), candidate.settlementDiffersFromProposal, raw.proposalHash,
      raw.proposalBlockNumber, raw.proposalLogIndex, candidate.gamma.status,
      candidate.gamma.hashHypothesisJoined,
      candidate.gamma.markets.map((market) => market.id ?? "").join(";"),
      candidate.gamma.markets.map((market) => market.questionID ?? market.questionId ?? market.question_id ?? "").join(";"),
      candidate.gamma.markets.map((market) => market.question ?? "").join(";"),
      JSON.stringify(candidate.gamma.attempts), candidate.requestCacheFile,
      candidate.identityVerifiedAgainstReceipts, candidate.controlDisputeAbsenceVerifiedAgainstLogs,
    ];
  });
  await atomicWrite("data/pilot/audit.csv", [headers, ...rows].map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n");

  const disputed = samples.filter((sample) => sample.kind === "disputed");
  const disputedCandidates = candidates.filter((candidate) => candidate.sampleKind === "disputed");
  const joined = candidates.filter((candidate) => candidate.gamma.status === "joined");
  const joinedDisputed = joined.filter((candidate) => candidate.sampleKind === "disputed");
  const gammaErrors = candidates.filter((candidate) => candidate.gamma.attempts.some((attempt) => attempt.error));
  const lines = [
    "# ChallengeLens B1 pilot", "",
    `Run mode: ${options.offline ? "offline cache replay" : options.refresh ? "fresh collection (--refresh)" : "cache-first collection"}.`, "",
    "This is a capped, ID-ordered discovery sample, not a population estimate or a historical evidence packet.",
    "Adapter seeds are unverified. Gamma joins and extracted text do not verify identity or historical rules.", "",
    "| Count | Disputed | Undisputed controls | Total |",
    "| --- | ---: | ---: | ---: |",
    `| All sampled requests | ${disputed.length} | ${samples.length - disputed.length} | ${samples.length} |`,
    `| Configured Polymarket adapter seeds | ${disputedCandidates.length} | ${candidates.length - disputedCandidates.length} | ${candidates.length} |`,
    `| Gamma joined by exact returned ID | ${joinedDisputed.length} | ${joined.length - joinedDisputed.length} | ${joined.length} |`,
    `| Ancillary hash hypothesis joined | ${disputedCandidates.filter((candidate) => candidate.gamma.hashHypothesisJoined).length} | ${candidates.filter((candidate) => candidate.sampleKind === "undisputed_control" && candidate.gamma.hashHypothesisJoined).length} | ${candidates.filter((candidate) => candidate.gamma.hashHypothesisJoined).length} |`,
    "",
    `Candidates with any Gamma lookup error/mismatch/ambiguity: ${gammaErrors.length}.`,
    `Ancillary decode errors: ${candidates.filter((candidate) => candidate.ancillary.error).length}.`,
    `Sources with errors: ${sources.filter((source) => source.error).length}.`,
    "",
    "## Frozen sources", "",
    "| Deployment | Block | Block hash | Disputed | Controls | Control filter | Error |",
    "| --- | ---: | --- | ---: | ---: | --- | --- |",
    ...sources.map((source) => `| ${md(source.deployment)} | ${md(source.block?.number)} | ${md(source.block?.hash)} | ${source.disputed} | ${source.controls} | ${md(source.controlFilter)} | ${md(source.error ?? "none")} |`),
    "",
    "Each deployment uses its own cached _meta block; all its pages use that block number. Cached metadata freezes reruns. Use --refresh for a new snapshot.",
    "",
    "## By proposal year", "",
    "Fallback: request event year if no proposal timestamp. Counts refer only to the sampled rows.", "",
    "| Year | All disputed | Adapter disputed | Gamma joined disputed | All controls | Adapter controls | Gamma joined controls |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const candidateByKey = new Map(candidates.map((candidate) => [`${candidate.deployment}:${candidate.raw.id}`, candidate]));
  const years = [...new Set(samples.map(year))].sort();
  for (const value of years) {
    const inYear = samples.filter((sample) => year(sample) === value);
    const counts = ["disputed", "undisputed_control"].flatMap((kind) => {
      const matching = inYear.filter((sample) => sample.kind === kind);
      const adapter = matching.filter((sample) => candidateByKey.has(`${sample.deployment}:${sample.raw.id}`));
      const gamma = adapter.filter((sample) => candidateByKey.get(`${sample.deployment}:${sample.raw.id}`)?.gamma.status === "joined");
      return [matching.length, adapter.length, gamma.length];
    });
    lines.push(`| ${md(value)} | ${counts.join(" | ")} |`);
  }
  lines.push("", "## Requester frequency (all sampled requests, before adapter filtering)", "",
    "| Requester | Total | Disputed | Controls |",
    "| --- | ---: | ---: | ---: |");
  for (const row of requesterCounts(samples)) {
    lines.push(`| ${row.requester} | ${row.total} | ${row.disputed} | ${row.controls} |`);
  }
  lines.push("", "## Up to 10 disputed examples", "",
    "Changed outcomes appear first, then source/request ID order. Fewer than 10 means the sample did not supply 10 adapter disputes.", "",
    "| Deployment / request | Title | Proposed at (UTC) | Proposed value | Settlement value | Disputed at (UTC) | Settlement differs? | Gamma |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |");
  const examples = [...disputedCandidates].sort((a, b) =>
    Number(b.settlementDiffersFromProposal === true) - Number(a.settlementDiffersFromProposal === true) ||
    a.deployment.localeCompare(b.deployment, "en") || a.raw.id.localeCompare(b.raw.id, "en"));
  for (const candidate of examples.slice(0, 10)) {
    const raw = candidate.raw;
    lines.push(`| ${md(`${candidate.deployment} / ${raw.id}`)} | ${md(candidate.ancillary.title)} | ${iso(raw.proposalTimestamp)} | ${md(raw.proposedPrice)} | ${md(raw.settlementPrice)} | ${iso(raw.disputeTimestamp)} | ${md(candidate.settlementDiffersFromProposal)} | ${candidate.gamma.status} |`);
  }
  lines.push("", "## Review limits", "",
    "- Values are raw oracle integers, compared with BigInt. No floating point conversion or outcome label inference.",
    "- A changed settlement is a lead for an incorrect/premature proposal, not a label or proof of its cause. Unchanged settlements and undisputed proposals are not automatically supported.",
    "- Base text comes from original ancillary bytes. Title/description/rule extraction is heuristic; the complete text and hex remain in every row.",
    "- Hashing ancillary bytes to obtain questionID is an adapter-specific hypothesis. Hint-based joins are recorded separately; neither verifies the onchain identity.",
    "- Gamma text is current discovery metadata, not historical rule wording. Clarifications, resets, authoritative owners, receipts and evidence provenance remain B2 work.",
    "- Control dispute absence is checked only against returned subgraph fields, not transaction logs. Verify deployment null/zero conventions and receipts before using controls.",
    "- The two deployment snapshots are independent. Do not treat their capped samples as an exhaustive or representative history.",
    "- Source errors, missing cache entries or Gamma failures make the run incomplete; partial outputs remain available for inspection.", "");
  await atomicWrite("data/pilot/summary.md", lines.join("\n"));
}
