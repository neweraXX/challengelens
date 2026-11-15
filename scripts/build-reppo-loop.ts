import { mkdir, readFile, writeFile } from "node:fs/promises";
import { procedureChange } from "../src/reppo/changes.js";
import { PROCEDURE_VERSION } from "../src/judge/prompt.js";
import type { ReppoLoop } from "../src/reppo/changes.js";
async function main() {
  const rows = (await readFile("procedures/changes.jsonl", "utf8")).trim().split(/\r?\n/u).filter(Boolean).map((line) => procedureChange(JSON.parse(line)));
  const data: ReppoLoop = { generated_at: new Date().toISOString(), changes: rows };
  await mkdir("web/public/data", { recursive: true });
  await writeFile("web/public/data/reppo-loop.json", JSON.stringify(data, null, 2) + "\n");
  await writeFile("web/public/data/procedure.json", JSON.stringify({ procedure_version: PROCEDURE_VERSION }) + "\n");
  console.log(`Published ${rows.length} accepted/rejected change records; 0 inference calls.`);
}
main().catch(() => { console.error("Reppo loop generation failed; validate procedures/changes.jsonl."); process.exitCode = 1; });
