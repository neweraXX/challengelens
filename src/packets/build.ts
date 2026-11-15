import type { Candidate, GammaMarket } from "../collect/types.js";
import { canonicalJson, inputHash, sha256 } from "./canonical.js";
import { selectFixedTime } from "./fixed-time.js";
import type { LabeledCase, ModelInputs, Schedule, TimingLabel } from "./types.js";

export const TOO_EARLY = "-57896044618658097711785492504343953926634992332820282019728792003956564819968";
const YES = "1000000000000000000";
const NO = "0";
const HALF = "500000000000000000";
export const SCHEDULE_KEYS = [
  "startDate", "endDate", "startDateIso", "endDateIso", "gameStartTime",
  "eventStartTime", "startTime", "endTime", "scheduledStartTime", "scheduledEndTime",
] as const;

function schedule(value: GammaMarket): Schedule {
  const result: Schedule = {};
  for (const key of SCHEDULE_KEYS) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) result[key] = field;
    else if (typeof field === "number" && Number.isFinite(field)) result[key] = String(field);
  }
  return result;
}

function events(market: GammaMarket): GammaMarket[] {
  return Array.isArray(market.events)
    ? market.events.filter((event): event is GammaMarket => typeof event === "object" && event !== null && !Array.isArray(event))
    : [];
}

export function titleStem(title: string): string {
  return title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gu, " ")
    .replace(/\d+/gu, " ").replace(/[^a-z]+/gu, " ").trim().replace(/\s+/gu, " ");
}

// Link all event IDs/slugs for a row. An ID-only row and a slug-only row are
// united when another row supplies both. Shared event aliases cannot cross splits.
export function eventGroups(rows: Candidate[]): Map<Candidate, string> {
  const parents = new Map<string, string>();
  function root(key: string): string {
    const parent = parents.get(key);
    if (!parent) { parents.set(key, key); return key; }
    if (parent === key) return key;
    const found = root(parent);
    parents.set(key, found);
    return found;
  }
  const aliases = new Map<Candidate, string[]>();
  for (const row of rows) {
    const market = row.gamma?.markets?.[0];
    const keys: string[] = [];
    if (market) for (const event of events(market)) {
      if ((typeof event.id === "string" && event.id.trim()) || (typeof event.id === "number" && Number.isFinite(event.id))) keys.push(`event:id:${event.id}`);
      if (typeof event.slug === "string" && event.slug) keys.push(`event:slug:${event.slug.toLowerCase()}`);
    }
    if (keys.length === 0) {
      const title = row.ancillary?.title ?? row.ancillary?.decodedText ?? "";
      keys.push(`title:${titleStem(title) || "unknown"}`);
    }
    const unique = [...new Set(keys)].sort();
    aliases.set(row, unique);
    for (const key of unique) {
      const a = root(unique[0]!);
      const b = root(key);
      if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
    }
  }
  return new Map(rows.map((row) => [row, root(aliases.get(row)![0]!)]));
}

export function privacyExclusion(text: string): string | null {
  if (/\b(?:sex|sexual\w*|porn\w*|nude\w*|nudity|intercourse|orgasm\w*|masturbat\w*|erotic\w*|prostitut\w*|onlyfans|hook[ -]?up|rape|raped|rapist|incest|fetish\w*|genital\w*|penis|vagina\w*|nipple\w*|condom\w*|ejaculat\w*|virginity|make[ -]out|sleep(?:ing)? with)\b/iu.test(text)) {
    return "sexual_content";
  }
  // Deliberately conservative lexical screening, including public figures when
  // status cannot be established offline. This is not an identity classifier.
  if (/\b(?:gay|lesbian|bisexual|transgender|heterosexual|homosexual|pregnan\w*|cancer|dementia|alzheimer\w*|hiv|aids|diagnos\w*|mental[ -]health|suicid\w*|self[ -]harm|medical[ -]condition)\b/iu.test(text)) {
    return "sensitive_personal_characteristics";
  }
  const title = text.split(/\r?\n/u)[0] ?? "";
  if (/\b(?:health|height|weight|iq|ethnicity|religion|dating|married|divorce\w*)\b/iu.test(title)) {
    return "sensitive_personal_characteristics";
  }
  return null;
}

export function settlementLabel(proposed: string | null, settled: string | null): {
  label: TimingLabel | null; flipped: boolean; exclusion: string | null;
} {
  if (proposed !== YES && proposed !== NO) return { label: null, flipped: false, exclusion: "non_binary_proposal" };
  if (settled === TOO_EARLY) return { label: "PREMATURE", flipped: false, exclusion: null };
  if (settled === YES || settled === NO) return { label: "TIMING_OK", flipped: settled !== proposed, exclusion: null };
  return { label: null, flipped: false, exclusion: settled === HALF ? "settled_50_50" : "odd_or_missing_settlement" };
}

export interface BuildResult {
  eligible: LabeledCase[];
  exclusions: Record<string, number>;
  sourceRows: number;
}

export function buildEligible(rows: Candidate[]): BuildResult {
  const eligible: LabeledCase[] = [];
  const exclusions: Record<string, number> = {};
  const groups = eventGroups(rows);
  const seenProposals = new Set<string>();
  const seenInputs = new Set<string>();
  function exclude(reason: string): void { exclusions[reason] = (exclusions[reason] ?? 0) + 1; }

  for (const row of rows) {
    if (row.sampleKind !== "disputed") { exclude("not_disputed"); continue; }
    if (row.raw?.state !== "Settled") { exclude("not_settled"); continue; }
    if (row.gamma?.status !== "joined" || row.gamma.markets.length !== 1) { exclude("gamma_not_uniquely_joined"); continue; }
    const label = settlementLabel(row.raw.proposedPrice, row.raw.settlementPrice);
    if (!label.label) { exclude(label.exclusion!); continue; }

    let rules: string;
    try {
      if (!/^0x(?:[0-9a-f]{2})+$/iu.test(row.raw.ancillaryData)) throw new Error();
      rules = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(row.raw.ancillaryData.slice(2), "hex"));
      if (!rules.trim() || !row.ancillary?.decodedText?.trim()) throw new Error();
    } catch { exclude("missing_or_invalid_rules_text"); continue; }
    if (rules !== row.ancillary.decodedText) { exclude("ancillary_text_mismatch"); continue; }
    const title = row.ancillary.title?.trim() || rules.split(/\r?\n/u)[0]!.slice(0, 300);
    const privacy = privacyExclusion(`${title}\n${rules}`);
    if (privacy) { exclude(privacy); continue; }
    const fixedTime = selectFixedTime(title, rules, row.raw.proposedPrice!);
    if (!fixedTime.match) { exclude(fixedTime.exclusion!); continue; }
    const timestamp = Number(row.raw.proposalTimestamp) * 1_000;
    if (!row.raw.proposalTimestamp || !/^\d+$/u.test(row.raw.proposalTimestamp) ||
        !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 253_402_300_799_000) {
      exclude("invalid_proposal_time"); continue;
    }

    const identity = row.raw.proposalHash && typeof row.raw.proposalLogIndex === "string"
      ? `${row.chainId}:${row.raw.proposalHash.toLowerCase()}:${row.raw.proposalLogIndex}`
      : `${row.chainId}:${row.deployment}:${row.raw.id}`;
    if (seenProposals.has(identity)) { exclude("duplicate_proposal"); continue; }
    const market = row.gamma.markets[0]!;
    const eventSchedules = events(market).map(schedule).sort((a, b) =>
      canonicalJson(a).localeCompare(canonicalJson(b), "en"));
    const inputs: ModelInputs = {
      title, rules_text: rules,
      proposal_time_utc: new Date(timestamp).toISOString(),
      proposed_value: row.raw.proposedPrice as ModelInputs["proposed_value"],
      gamma_scheduling: {
        provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY",
        market: schedule(market), events: eventSchedules,
      },
    };
    const packetHash = inputHash(inputs);
    if (seenInputs.has(packetHash)) { exclude("duplicate_model_inputs"); continue; }
    seenProposals.add(identity);
    seenInputs.add(packetHash);
    const caseId = `timing-${sha256(identity).slice(0, 24)}`;
    eligible.push({
      packet: {
        schema_version: "timing-packet-1", case_id: caseId, packet_hash: packetHash,
        event_group: groups.get(row)!,
        category: fixedTime.match.kind === "sports_scheduled" ? "sports_in_game"
          : fixedTime.match.kind.startsWith("crypto_") ? "crypto_fixed_time" : "fixed_window",
        fixed_time: fixedTime.match, model_inputs: inputs,
        provenance: {
          deployment: row.deployment, request_id: row.raw.id,
          proposal_hash: row.raw.proposalHash, proposal_log_index: row.raw.proposalLogIndex,
          identity_verified_against_receipts: row.identityVerifiedAgainstReceipts,
          historical_rule_updates_verified: false,
        },
      },
      label: {
        case_id: caseId, packet_hash: packetHash, label: label.label,
        expected_decision: label.label === "PREMATURE" ? "NOT_SUPPORTED_NOW" : "SUPPORTED_NOW",
        expected_reason: label.label === "PREMATURE" ? "PREMATURE" : null,
        outcome_flipped: label.flipped, settlement_price: row.raw.settlementPrice!,
        source: "ORACLE_SETTLEMENT_TIMING_PROXY", receipt_verified: row.identityVerifiedAgainstReceipts,
      },
    });
  }
  return { eligible, exclusions, sourceRows: rows.length };
}
