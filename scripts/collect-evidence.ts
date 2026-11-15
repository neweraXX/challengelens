import { readFile, rename, writeFile } from "node:fs/promises";
import { EvidenceCollector } from "../src/evidence/collect.js";
import type { EvidenceRow } from "../src/evidence/collect.js";
import type { CasePacket } from "../src/packets/types.js";
import { inputHash } from "../src/packets/canonical.js";

async function main() {
  const split = process.argv[2] ?? process.env.EVIDENCE_SPLIT ?? "sealed";
  if ((split !== "dev" && split !== "sealed" && split !== "sealed2") || process.argv.length > 3) throw new Error("Usage: collect-evidence [dev|sealed|sealed2] (default sealed)");
  const packets = (await readFile(`data/${split}/packets.jsonl`, "utf8")).split(/\r?\n/u).filter(Boolean).map((s) => JSON.parse(s) as CasePacket);
  const collector = new EvidenceCollector(); const rows: EvidenceRow[] = [];
  const counts = { sports_feed: 0, price_touch: 0, null: 0, errors: 0 };
  try {
    for (const p of packets) {
      let evidence: EvidenceRow["evidence"] = null; let error: string | null = null;
      try {
        if (inputHash(p.model_inputs) !== p.packet_hash) throw new Error("identity");
        evidence = await collector.collect(p);
      } catch { error = "Evidence collection failed"; counts.errors++; }
      counts[evidence?.kind ?? "null"]++;
      rows.push({ case_id: p.case_id, packet_hash: p.packet_hash, evidence, error });
    }
    const path = `data/${split}/evidence.jsonl`;
    await writeFile(`${path}.tmp`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); await rename(`${path}.tmp`, path);
    console.log(JSON.stringify(counts));
  } finally { await collector.close(); }
}
main().catch(() => { console.error("Evidence collection failed"); process.exitCode = 1; });
