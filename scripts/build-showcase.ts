import { actionMetrics } from "../src/gate/metrics.js";
import { EvidenceCollector } from "../src/evidence/collect.js";
import { asOf } from "../src/evidence/as-of.js";
import { evidenceMarkers } from "../src/evidence/markers.js";
import { evidenceHash } from "../src/packets/canonical.js";
import { writeBenchmark } from "./build-benchmark.js";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildEligible, eventGroups, TOO_EARLY } from "../src/packets/build.js";
import { MODELS } from "../src/judge/client.js";
import { earlyYes, evaluateGate } from "../src/gate/decide.js";
import { cacheKey, createReceipt, persistReceipt } from "../src/gate/receipt.js";
import type { LabeledCase } from "../src/packets/types.js";
import type { Verdict } from "../src/judge/schema.js";
import type { ApiAttempt } from "../src/judge/client.js";
import { clauseOffsets } from "../src/demo/math.js";
import { gammaStart, rulesObservationTime } from "../src/demo/schedule.js";
import { checkWithServ, validateDemoVerdict, verdictFromAttempt } from "../src/demo/serv.js";
import type { Benchmark, BenchmarkArm, Outcome, ShowcaseCase, Stats } from "../src/demo/types.js";

type Candidate = Parameters<typeof buildEligible>[0][number];
interface Trial {
  arm: "raw" | "serv"; case_id: string; packet_hash: string; repetition: number; status: string; verdict: Verdict | null;
  attempts: { started_at: string; usage: { total: number | null; cost_usd?: number | null } }[];
}
interface Pilot { state: { run: string; procedure_version?: string }; procedure_version?: string; trials: Trial[] }
interface Manifest { splits: { dev: { cases: { case_id: string }[] }; sealed: { cases: { event_group: string }[] } } }
const output = "web/public/data";
const cacheDir = ".cache/showcase";
const braves = "timing-1cb1c22e47ea5596f03eb22a";

async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function save(path: string, data: unknown): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value) || Number(value) <= 0) return null;
  const time = Number(value) * 1000;
  return Number.isSafeInteger(time) && time <= 253402300799000 ? new Date(time).toISOString() : null;
}
function emptyOutcomes(): Record<Outcome, number> { return { TOO_EARLY: 0, upheld: 0, flipped: 0, "50-50": 0, other: 0 }; }

/** All disputed adapter rows count, including those outside the fixed-time screen. */
function statsFor(rows: Candidate[]): Stats {
  const stats: Stats = { total: 0, outcomes: emptyOutcomes(), by_year: {}, scope: "Disputed Polymarket adapter proposals; settlement outcomes are timing proxies." };
  for (const row of rows) {
    if (row.sampleKind !== "disputed") continue;
    const raw = row.raw;
    const value = raw.settlementPrice;
    const outcome: Outcome = value === TOO_EARLY ? "TOO_EARLY" : value === "500000000000000000" ? "50-50"
      : value === "0" || value === "1000000000000000000" ? value === raw.proposedPrice ? "upheld" : "flipped" : "other";
    stats.total += 1;
    stats.outcomes[outcome] += 1;
    const year = timestamp(raw.proposalTimestamp)?.slice(0, 4) ?? "unknown";
    stats.by_year[year] ??= emptyOutcomes();
    stats.by_year[year]![outcome] += 1;
  }
  return stats;
}

function diversity(item: LabeledCase): string {
  const { packet } = item;
  if (packet.fixed_time?.kind !== "sports_scheduled") return packet.fixed_time!.kind;
  return packet.model_inputs.rules_text.match(/\b(?:MLB|NBA|NHL|WNBA|NFL)\b/iu)?.[0].toUpperCase() ?? "sports";
}

/** Stable greedy selection with hard quotas and a new category preferred each pass. */
function choose(eligible: LabeledCase[], devIds: Set<string>): LabeledCase[] {
  const selected: LabeledCase[] = [];
  const mandatory = eligible.find((item) => item.packet.case_id === braves);
  if (!mandatory || mandatory.label.label !== "PREMATURE") throw new Error("Required unsealed Braves case missing");
  selected.push(mandatory);
  const quota = { PREMATURE: 8, TIMING_OK: 4 };
  const required = [
    (item: LabeledCase) => diversity(item) === "NBA",
    (item: LabeledCase) => diversity(item) === "crypto_candle",
    (item: LabeledCase) => item.packet.fixed_time?.kind === "observation_window",
  ];
  // Cover the promised examples before filling quotas. Backtrack if a label
  // stratum is scarce, rather than weakening the 8/4 requirement.
  function cover(index: number): boolean {
    if (index === required.length) return true;
    const qualifies = required[index]!;
    if (selected.some(qualifies)) return cover(index + 1);
    const pool = eligible.filter((item) => !selected.includes(item) && qualifies(item))
      .sort((a, b) => Number(devIds.has(b.packet.case_id)) - Number(devIds.has(a.packet.case_id)) || a.packet.case_id.localeCompare(b.packet.case_id));
    for (const item of pool) {
      if (selected.filter((value) => value.label.label === item.label.label).length >= quota[item.label.label]) continue;
      selected.push(item);
      if (cover(index + 1)) return true;
      selected.pop();
    }
    return false;
  }
  if (!cover(0)) {
    const tally = new Map<string, number>();
    for (const item of eligible) { const k = `${diversity(item)}/${item.label.label}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    console.error("Eligible unsealed pool:", Object.fromEntries(tally));
    throw new Error("Cannot satisfy showcase diversity with unsealed cases and exact quotas");
  }
  const seenGroups = new Set(selected.map((item) => item.packet.event_group));
  const kinds = new Map<string, number>();
  for (const item of selected) kinds.set(diversity(item), (kinds.get(diversity(item)) ?? 0) + 1);
  for (const [label, count] of [["PREMATURE", 8], ["TIMING_OK", 4]] as const) {
    while (selected.filter((item) => item.label.label === label).length < count) {
      const pool = eligible.filter((item) => item.label.label === label && !selected.includes(item));
      pool.sort((a, b) => (kinds.get(diversity(a)) ?? 0) - (kinds.get(diversity(b)) ?? 0)
        || Number(seenGroups.has(a.packet.event_group)) - Number(seenGroups.has(b.packet.event_group))
        || Number(devIds.has(b.packet.case_id)) - Number(devIds.has(a.packet.case_id))
        || a.packet.case_id.localeCompare(b.packet.case_id));
      const next = pool[0];
      if (!next) throw new Error(`Not enough unsealed ${label} cases`);
      selected.push(next);
      seenGroups.add(next.packet.event_group);
      kinds.set(diversity(next), (kinds.get(diversity(next)) ?? 0) + 1);
    }
  }
  for (const kind of ["MLB", "NBA", "crypto_candle", "observation_window"]) {
    if (!selected.some((item) => diversity(item) === kind)) throw new Error(`Selection lacks ${kind}; review selector before billing`);
  }

  return selected;
}

function benchmark(pilot: Pilot, eligible: LabeledCase[], devIds: Set<string>): Benchmark {
  const labels = new Map(eligible.map((item) => [item.packet.case_id, item]));
  function arm(name: "serv" | "raw"): BenchmarkArm | null {
    const trials = pilot.trials.filter((trial) => trial.arm === name && devIds.has(trial.case_id));
    if (!trials.length) return null;
    // Fail closed rather than displaying metrics from a different packet/split.
    if (trials.some((trial) => labels.get(trial.case_id)?.packet.packet_hash !== trial.packet_hash)) throw new Error("Pilot packet hash mismatch");
    const groups = new Map<string, Trial[]>();
    for (const trial of trials) groups.set(trial.case_id, [...(groups.get(trial.case_id) ?? []), trial]);
    const attempts = trials.flatMap((trial) => trial.attempts);
    const costs = attempts.map((attempt) => attempt.usage.cost_usd);
    return {
      action_metrics: actionMetrics(eligible.filter((e) => devIds.has(e.packet.case_id)).map((e) => e.packet), trials.map((r) => ({ case_id: r.case_id, action: r.status === "valid" && r.verdict ? r.verdict.decision === "SUPPORTED_NOW" ? "PROCEED" : r.verdict.reason === "PREMATURE" ? "WAIT" : "NEED_EVIDENCE" : null })), new Map(eligible.map((e) => [e.packet.case_id, e.label]))),
      trials: trials.length, valid: trials.filter((trial) => trial.status === "valid").length,
      false_supported: trials.filter((trial) => labels.get(trial.case_id)!.label.label === "PREMATURE" && trial.verdict?.decision === "SUPPORTED_NOW").length,
      premature_trials: trials.filter((trial) => labels.get(trial.case_id)!.label.label === "PREMATURE").length,
      correct: trials.filter((trial) => trial.status === "valid" && trial.verdict?.decision === labels.get(trial.case_id)!.label.expected_decision).length,
      abstained: trials.filter((trial) => trial.verdict?.decision === "INSUFFICIENT_EVIDENCE").length,
      consistent_cases: [...groups.values()].filter((group) => group.length === 3 && group.every((trial) => trial.status === "valid") &&
        new Set(group.map((trial) => trial.verdict?.decision)).size === 1).length,
      cases: groups.size,
      cost_usd: costs.every((cost): cost is number => typeof cost === "number") ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      tokens: attempts.reduce((sum, attempt) => sum + (attempt.usage.total ?? 0), 0),
    };
  }
  return { label: "Development set (prompt tuned on it), n=15×3", run: pilot.state.run,
    date: pilot.trials[0]?.attempts[0]?.started_at.slice(0, 10) ?? "unknown",
    procedure: pilot.procedure_version ?? pilot.state.procedure_version ?? "Pilot procedure version not recorded",
    arms: { raw: arm("raw"), serv: arm("serv") }, sealed: "pending", source: `eval/runs/${pilot.state.run}/results.json` };
}

async function main(): Promise<void> {
  const rows = (await readFile("data/pilot/candidates.jsonl", "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as Candidate);
  const manifest = await json<Manifest>("data/manifests/split.json");
  // Only event-group identifiers are used from the sealed manifest. No sealed
  // packet or label path is read, copied, mounted by the app, or served.
  const sealedGroups = new Set(manifest.splits.sealed.cases.map((item) => item.event_group));
  const holdoutIds = new Set<string>();
  try {
    const holdout = await json<{ cases: { case_id: string; event_group: string }[] }>("data/manifests/holdout2.json");
    for (const item of holdout.cases) { sealedGroups.add(item.event_group); holdoutIds.add(item.case_id); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const devIds = new Set(manifest.splits.dev.cases.map((item) => item.case_id));
  const groups = eventGroups(rows);
  // Filter BEFORE building labels/packets: sealed examples contribute only to
  // the aggregate disputed-proposal counts above.
  const safeRows = rows.filter((row) => !sealedGroups.has(groups.get(row)!));
  const eligible = buildEligible(safeRows).eligible.filter((item) => !holdoutIds.has(item.packet.case_id));
  const runs = (await readdir("eval/runs", { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith("pilot-"))
    .map((entry) => entry.name).sort().reverse();
  let pilot: Pilot | null = null;
  for (const run of runs) {
    try {
      const candidate = await json<Pilot>(join("eval/runs", run, "results.json"));
      if (candidate.trials.length && candidate.trials.every((trial) => devIds.has(trial.case_id))) { pilot = candidate; break; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!pilot) throw new Error("No development pilot results found");
  await save(`${output}/stats.json`, statsFor(rows));
  const benchmarkRuns = (process.env.BENCHMARK_RUN_DIRS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (benchmarkRuns.length) await writeBenchmark(benchmarkRuns);
  else {
    // Preserve an explicitly generated multi-model benchmark during inference.
    let multiModel = false;
    try { multiModel = Array.isArray((await json<{ models?: unknown }>(`${output}/benchmark.json`)).models); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!multiModel) await save(`${output}/benchmark.json`, benchmark(pilot, eligible, devIds));
  }
  if (process.argv.includes("--metadata-only")) { console.log("Wrote aggregate stats and development benchmark (no inference)."); return; }

  const selected = choose(eligible, devIds);
  // Match raw ancillary records through proposal identity, never through title.
  const byProposal = new Map(safeRows.map((row) => [`${row.deployment}:${row.raw.id}`, row]));
  const showcase: ShowcaseCase[] = [];
  const collector = new EvidenceCollector();
  try { for (const { packet, label } of selected) {
    const evidence = await collector.collect(packet).catch(() => null);
    const view = asOf(evidence, packet.model_inputs.proposal_time_utc, packet.model_inputs.rules_text);
    const inputs = { ...packet.model_inputs, ...(view ? { evidence_as_of_proposal: view } : {}) };
    const cache = `${cacheDir}/${cacheKey(packet.packet_hash, inputs.proposal_time_utc, MODELS.serv, evidenceHash(inputs))}.json`;
    let verdict: Verdict;
    let requestId: string | null = null;
    try {
      const saved = await json<{ verdict: unknown; serv_request_id: string | null; packet_hash: string; evidence_hash: string }>(cache);
      if (saved.packet_hash !== packet.packet_hash || saved.evidence_hash !== evidenceHash(inputs)) throw new Error("Showcase cache identity mismatch");
      verdict = validateDemoVerdict(saved.verdict, inputs.rules_text);
      requestId = saved.serv_request_id;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Persist even an invalid/failed response before validation, so reruns
      // never silently pay for it again. Explicit retries remove the attempt.
      const attemptPath = cache.replace(/\.json$/u, ".attempt.json");
      let attempt: ApiAttempt | null = null;
      try { attempt = await json<ApiAttempt>(attemptPath); }
      catch (readError) { if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError; }
      verdict = attempt ? verdictFromAttempt(attempt, inputs.rules_text)
        : await checkWithServ(inputs, async (result) => { requestId = result.serv_request_id ?? null; await save(attemptPath, result); });
      requestId = attempt?.serv_request_id ?? requestId;
      await save(cache, { verdict, serv_request_id: requestId, packet_hash: packet.packet_hash, evidence_hash: evidenceHash(inputs) });
    }
    const row = byProposal.get(`${packet.provenance.deployment}:${packet.provenance.request_id}`);
    if (!row) throw new Error("Missing original proposal");
    const rawTrial = devIds.has(packet.case_id) ? pilot.trials.find((trial) => trial.arm === "raw" && trial.case_id === packet.case_id &&
      trial.packet_hash === packet.packet_hash && trial.status === "valid") : undefined;
    const raw = row.raw;
    const gated = evaluateGate(inputs, verdict);
    const receipt = createReceipt({ ...gated, evidence, packet_hash: packet.packet_hash, case_id: packet.case_id, market_id: inputs.gamma_scheduling.market.id ?? null,
      proposal_time_utc: inputs.proposal_time_utc, model: MODELS.serv, serv_request_id: requestId, serv_verdict: verdict });
    await persistReceipt(receipt);
    showcase.push({
      ...gated, evidence, ...evidenceMarkers(evidence), receipt,
      case_id: packet.case_id, packet_hash: packet.packet_hash, event_group: packet.event_group,
      title: inputs.title, category: packet.category, fixed_time_kind: packet.fixed_time!.kind,
      rules_text: inputs.rules_text, proposal_time_utc: inputs.proposal_time_utc,
      dispute_time_utc: timestamp(raw.disputeTimestamp), settlement_time_utc: timestamp(raw.settlementTimestamp),
      settlement_label: label.label === "PREMATURE" ? "TOO_EARLY" : label.outcome_flipped ? "flipped" : "upheld",
      settlement_value: label.settlement_price, settlement_tx_hash: raw.settlementHash ?? null,
      bond: raw.bond ?? null, reward: raw.reward ?? null, currency: raw.currency ?? null,
      request_id: packet.provenance.request_id, proposal_tx_hash: packet.provenance.proposal_hash,
      gamma_scheduling: inputs.gamma_scheduling, model_inputs: inputs,
      verdict, clause_offsets: clauseOffsets(inputs.rules_text, verdict.checks.timing.clause_quote)!,
      raw_verdict: rawTrial?.verdict ?? null, raw_run: rawTrial ? pilot.state.run : null,
      rules_time_utc: rulesObservationTime(inputs, packet.fixed_time!.kind), gamma_time_utc: gammaStart(inputs),
      early_needs_evidence: earlyYes(inputs),
    });
    console.log(`Ready: ${packet.case_id}`);
  }
  } finally { await collector.close(); }
  if (showcase.length !== 12 || showcase.some((item) => sealedGroups.has(item.event_group))) throw new Error("Showcase isolation check failed");
  await save(`${output}/showcase.json`, showcase);
  console.log("Wrote 12 unsealed cases (8 TOO_EARLY, 4 timing-OK). Cached responses are reusable.");
}

main().catch((error: unknown) => {
  // Keep provider bodies, credentials, and transport errors out of terminal logs.
  console.error("Showcase generation failed. Check selection/credentials and existing cache; completed calls remain cached.");
  if (error instanceof Error && /^(Required|Not enough|Selection|Cannot satisfy|No development|Pilot packet|Missing original|Showcase isolation|SERV|Invalid verdict|Invalid SERV|Inconsistent)/u.test(error.message)) {
    console.error(error.message);
  }
  process.exitCode = 1;
});
