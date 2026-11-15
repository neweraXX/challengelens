import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Candidate } from "../src/collect/types.js";
import { safeMessage } from "../src/collect/http.js";
import { buildEligible } from "../src/packets/build.js";
import { archiveB2 } from "../src/packets/archive.js";
import { FIXED_TIME_POLICY } from "../src/packets/fixed-time.js";
import { canonicalJson, sha256 } from "../src/packets/canonical.js";
import { CATEGORIES, selectSplits, SPLIT_SEED } from "../src/packets/split.js";
import type { LabeledCase } from "../src/packets/types.js";

const SOURCE = "data/pilot/candidates.jsonl";

function jsonl(values: unknown[]): string {
  return values.map(canonicalJson).join("\n") + "\n";
}

function counts(cases: LabeledCase[]): Record<string, unknown> {
  return {
    total: cases.length,
    PREMATURE: cases.filter((item) => item.label.label === "PREMATURE").length,
    TIMING_OK: cases.filter((item) => item.label.label === "TIMING_OK").length,
    outcome_flipped: cases.filter((item) => item.label.outcome_flipped).length,
    event_groups: new Set(cases.map((item) => item.packet.event_group)).size,
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, cases.filter((item) => item.packet.category === category).length])),
    fixed_time_kinds: Object.fromEntries([...new Set(cases.map((item) => item.packet.fixed_time?.kind ?? "unclassified"))].sort()
      .map((kind) => [kind, cases.filter((item) => item.packet.fixed_time?.kind === kind).length])),
  };
}

function cell(text: string): string {
  return text.replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("Usage: npm run packets (fixed pilot input; no network)");
  const source = await readFile(SOURCE, "utf8");
  const rows: Candidate[] = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let row: Candidate;
    try {
      row = JSON.parse(line) as Candidate;
      if (!row || !row.raw || !row.ancillary || !row.gamma || !Array.isArray(row.gamma.markets)) throw new Error();
    } catch { throw new Error(`Malformed pilot row at line ${index + 1}; no split files written.`); }
    rows.push(row);
  }
  rows.sort((a, b) => `${a.deployment}:${a.raw.id}`.localeCompare(`${b.deployment}:${b.raw.id}`, "en"));
  const built = buildEligible(rows);
  console.log(JSON.stringify({ eligible: counts(built.eligible), exclusions: built.exclusions }, null, 2));
  const splits = selectSplits(built.eligible); // Fails before any writes if quotas cannot be met.
  const files: Record<string, string> = {};
  for (const split of ["dev", "sealed"] as const) {
    files[`data/${split}/packets.jsonl`] = jsonl(splits[split].map((item) => item.packet));
    files[`data/${split}/labels.jsonl`] = jsonl(splits[split].map((item) => item.label));
  }
  const review = [
    "# Timing v2 fixed-time pilot: 15 development cases", "",
    "Review before inference. Labels are oracle-settlement timing proxies, not independent historical timing proof.",
    "Privacy screening is conservative and lexical; Hà must skim titles/rules for missed sensitive cases.",
    "Current Gamma scheduling may differ from history. No outside outcome evidence is supplied.",
    "Only fixed-time heuristic matches are eligible. Sports durations in timing-v3 are explicit policy estimates, not observed completion.", "",
    "| Case | Category | Title | Proposal time (UTC) | Proposed value | Label | Flipped outcome? | Rule excerpt (at most 300 characters) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...splits.dev.map(({ packet, label }) => {
      const description = packet.fixed_time?.matched_text ?? packet.model_inputs.rules_text;
      const excerpt = Array.from(description.replace(/\s+/gu, " ").trim()).slice(0, 300).join("");
      return `| ${packet.case_id} | ${packet.category} | ${cell(packet.model_inputs.title)} | ${packet.model_inputs.proposal_time_utc} | ${packet.model_inputs.proposed_value} | ${label.label} | ${label.outcome_flipped} | ${cell(excerpt)} |`;
    }), "",
    "PREMATURE expects NOT_SUPPORTED_NOW/PREMATURE; TIMING_OK expects SUPPORTED_NOW/null for timing only.",
    "A binary settlement (even one equal to the proposal) does not independently prove decidability at proposal time.",
    "Sports without an explicit rules end use conservative duration estimates. Inspect dates/timezones, candle-close conventions and possible postponements before interpreting the gate.", "",
  ];
  files["data/dev/review.md"] = review.join("\n");
  const manifest = {
    schema_version: "timing-split-2", seed: SPLIT_SEED,
    scope: "fixed-time", fixed_time_policy: FIXED_TIME_POLICY,
    previous_split_archive: "data/archive/b2",
    source: { path: SOURCE, sha256: sha256(source), rows: rows.length },
    selection: {
      dev: { PREMATURE: 8, TIMING_OK: 7 }, sealed: { PREMATURE: 15, TIMING_OK: 15 },
      max_cases_per_event_group: 2, event_groups_disjoint: true,
      category_preference: CATEGORIES, method: "seeded category round-robin groups; exact quota dynamic program",
      grouping: "connected Gamma event ID/slug aliases; normalized title stem when no event alias exists",
    },
    eligible: counts(built.eligible),
    exclusions: { convention: "one primary reason per excluded row; eligible but unselected is separate", by_reason: built.exclusions,
      total: Object.values(built.exclusions).reduce((sum, count) => sum + count, 0) },
    eligible_not_selected: built.eligible.length - splits.dev.length - splits.sealed.length,
    splits: Object.fromEntries((["dev", "sealed"] as const).map((split) => [split, {
      counts: counts(splits[split]),
      cases: splits[split].map(({ packet }) => ({ case_id: packet.case_id, packet_hash: packet.packet_hash,
        event_group: packet.event_group, category: packet.category, fixed_time_kind: packet.fixed_time!.kind })),
    }])),
    files: Object.fromEntries(Object.entries(files).map(([path, contents]) => [path, sha256(contents)])),
    assumptions: [
      "TOO_EARLY maps to PREMATURE; binary equality/flip maps to TIMING_OK as instructed, without receipt verification.",
      "TIMING_OK is a proxy: binary settlement does not prove the proposal was timely or timing is identifiable from these inputs.",
      "Ancillary bytes are preserved as base rules; authoritative historical updates/resets are not reconstructed.",
      "Scheduling fields are current Gamma discovery metadata, not verified historical event times; startDate may be listing time.",
      "Privacy exclusions use conservative keyword rules; manual review can require rebuilding before evaluation.",
      "Fixed-time regex selection screens date/time/candle/window wording; it does not prove the governing time or actual game completion.",
    ],
  };
  files["data/manifests/split.json"] = JSON.stringify(manifest, null, 2) + "\n";
  // Never expose old sealed labels to inference; preserve them verbatim offline.
  await archiveB2();
  // Stage all outputs, then publish; manifest is last and contains the file hashes.
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, contents, "utf8");
  }
  for (const path of Object.keys(files)) await rename(`${path}.tmp`, path);
  console.log(JSON.stringify({ dev: counts(splits.dev), sealed: counts(splits.sealed), exclusions: built.exclusions }, null, 2));
  console.log("Wrote packets, separate labels, split manifest and data/dev/review.md. No inference performed.");
}

main().catch((error: unknown) => {
  console.error(`Packet build failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});
