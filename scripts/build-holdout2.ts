import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Candidate } from "../src/collect/types.js";
import { buildEligible } from "../src/packets/build.js";
import { canonicalJson, sha256 } from "../src/packets/canonical.js";
import { FIXED_TIME_POLICY } from "../src/packets/fixed-time.js";
import { HOLDOUT2_SEED, selectHoldout2 } from "../src/packets/holdout2.js";
import type { ExposedIdentity } from "../src/packets/holdout2.js";

const jsonl = <T>(s: string): T[] => s.split(/\r?\n/u).filter((s) => s.trim()).map((s) => JSON.parse(s) as T);
async function main() {
  if (process.argv.length !== 2) throw new Error("No arguments permitted");
  // Refuse any rebuild, including partially written artifacts: never refresh an evaluated holdout.
  for (const path of ["data/sealed2/packets.jsonl", "data/sealed2/labels.jsonl", "data/manifests/holdout2.json"]) {
    try { await lstat(path); throw new Error("Holdout already reserved"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const source = await readFile("data/pilot/candidates.jsonl", "utf8");
  const rows = jsonl<Candidate>(source);
  if (rows.some((r) => !r || !r.raw || !r.ancillary || !r.gamma || !Array.isArray(r.gamma.markets))) throw new Error("Malformed pilot input");
  rows.sort((a, b) => `${a.deployment}:${a.raw.id}`.localeCompare(`${b.deployment}:${b.raw.id}`, "en"));
  const built = buildEligible(rows); // Exactly the build-packets policy and ordering.
  const exposed: ExposedIdentity[] = [];
  for (const split of ["dev", "sealed"]) exposed.push(...jsonl<ExposedIdentity>(await readFile(`data/${split}/packets.jsonl`, "utf8")));
  const manifest = JSON.parse(await readFile("data/manifests/split.json", "utf8")) as { fixed_time_policy: typeof FIXED_TIME_POLICY; splits: Record<string, { cases: ExposedIdentity[] }> };
  if (canonicalJson(manifest.fixed_time_policy) !== canonicalJson(FIXED_TIME_POLICY)) throw new Error("Fixed-time policy differs from the frozen split");
  for (const split of ["dev", "sealed"]) exposed.push(...manifest.splits[split]!.cases);
  const showcase = JSON.parse(await readFile("web/public/data/showcase.json", "utf8")) as ExposedIdentity[];
  if (!Array.isArray(showcase) || showcase.some((r) => typeof r.case_id !== "string")) throw new Error("Invalid showcase identities");
  exposed.push(...showcase);
  const result = selectHoldout2(built.eligible, exposed);
  if (!result.selected.length) throw new Error("Empty holdout pool");
  const tally = (keys: string[]) => Object.fromEntries([...new Set(keys)].sort().map((k) => [k, keys.filter((v) => v === k).length]));
  const counts = { total: result.selected.length, event_groups: new Set(result.selected.map((r) => r.packet.event_group)).size,
    labels: tally(result.selected.map((r) => r.label.label)), categories: tally(result.selected.map((r) => r.packet.category)),
    kinds: tally(result.selected.map((r) => r.packet.fixed_time!.kind)) };
  const metadata = { schema_version: "timing-holdout2-1", seed: HOLDOUT2_SEED, fixed_time_policy: FIXED_TIME_POLICY,
    source_sha256: sha256(source), pool_sha256: sha256(canonicalJson(built.eligible)), eligible_pool: built.eligible.length,
    cases: result.selected.map(({ packet }) => ({ case_id: packet.case_id, packet_hash: packet.packet_hash, event_group: packet.event_group })),
    selection: { max_cases_per_event_group: 2, maximize_cases: true, balance: "minimum absolute label difference at maximum size", order: "seeded SHA256 of group and case ID" }, counts,
    exclusions: { eligibility: built.exclusions, ...result.exclusions, exposed_ids: result.excluded_ids, exposed_groups: result.excluded_groups } };
  const files = { "data/sealed2/packets.jsonl": result.selected.map((r) => canonicalJson(r.packet)).join("\n") + "\n",
    "data/sealed2/labels.jsonl": result.selected.map((r) => canonicalJson(r.label)).join("\n") + "\n",
    "data/manifests/holdout2.json": JSON.stringify(metadata, null, 2) + "\n" };
  await mkdir("data/sealed2", { recursive: true }); await mkdir("data/manifests", { recursive: true });
  // Exclusive reservation before publishing; partial builds cannot be silently replaced.
  await writeFile("data/sealed2/.build-reserved", "holdout2\n", { flag: "wx" });
  for (const [path, contents] of Object.entries(files)) { await writeFile(`${path}.tmp`, contents, { flag: "wx" }); await rename(`${path}.tmp`, path); }
  console.log(JSON.stringify({ ...counts, exclusions: metadata.exclusions }));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-holdout2.ts")) {
  main().catch(() => { console.error("Holdout2 build refused or failed; no case contents printed."); process.exitCode = 1; });
}
