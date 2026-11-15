import { appendFile, mkdir } from "node:fs/promises";
import { procedureChange } from "../src/reppo/changes.js";
async function main() {
  if (process.argv.length > 3) throw new Error("Usage: log-change '<JSON>' (or pipe JSON on stdin)");
  let text = process.argv[2] ?? "";
  if (!text) for await (const chunk of process.stdin) { text += String(chunk); if (Buffer.byteLength(text) > 50_000) throw new Error("Change record exceeds 50 KB"); }
  if (Buffer.byteLength(text) > 50_000) throw new Error("Change record exceeds 50 KB");
  const record = procedureChange(JSON.parse(text));
  await mkdir("procedures", { recursive: true });
  await appendFile("procedures/changes.jsonl", JSON.stringify(record) + "\n", { mode: 0o600 });
  console.log(`Recorded ${record.accepted ? "accepted" : "rejected"} procedure change.`);
}
main().catch(() => { console.error("Change record rejected; supply valid JSON with all required fields."); process.exitCode = 1; });
