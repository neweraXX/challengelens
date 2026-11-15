import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "./canonical.js";

const FILES = [
  "dev/packets.jsonl", "dev/labels.jsonl", "dev/review.md",
  "sealed/packets.jsonl", "sealed/labels.jsonl", "manifests/split.json",
] as const;

async function optionalText(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Copy bytes as UTF-8 text without parsing packets/labels. Archive once, verify
// its hashes on reruns, and never overwrite the B2 snapshot with a B3 split.
export async function archiveB2(project = "."): Promise<void> {
  const destination = join(project, "data/archive/b2");
  const markerPath = join(destination, "archive.json");
  const marker = await optionalText(markerPath);
  if (marker !== null) {
    const metadata = JSON.parse(marker) as { version: number; original_split_present?: boolean; files: Record<string, string> };
    if (metadata.version !== 1 || !metadata.files) throw new Error("Invalid B2 archive marker; refusing to overwrite split files.");
    if (metadata.original_split_present === false && Object.keys(metadata.files).length === 0) return;
    for (const path of FILES) {
      const archived = await optionalText(join(destination, path));
      if (archived === null || sha256(archived) !== metadata.files[path]) throw new Error(`B2 archive hash mismatch: ${path}`);
    }
    return;
  }
  const contents = new Map<string, string>();
  for (const path of FILES) {
    const value = await optionalText(join(project, "data", path));
    if (value !== null) contents.set(path, value);
  }
  if (contents.size === 0) {
    // Record absence too, so a fresh checkout remains rerunnable after its first B3 build.
    await mkdir(destination, { recursive: true });
    await writeFile(markerPath, JSON.stringify({ version: 1, original_split_present: false, files: {} }) + "\n", { encoding: "utf8", flag: "wx" });
    return;
  }
  if (contents.size !== FILES.length) throw new Error("Incomplete old split; refusing to overwrite before a complete B2 archive exists.");
  const manifest = JSON.parse(contents.get("manifests/split.json")!) as { schema_version: string };
  if (manifest.schema_version !== "timing-split-1") throw new Error("Missing B2 archive and current split is not B2; restore B2 before replacing it.");
  for (const [path, value] of contents) {
    const output = join(destination, path);
    await mkdir(dirname(output), { recursive: true });
    // Resume an interrupted archive only when the existing bytes agree.
    const previous = await optionalText(output);
    if (previous !== null && previous !== value) throw new Error(`Conflicting B2 archive file: ${path}`);
    if (previous === null) await writeFile(output, value, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(markerPath, JSON.stringify({ version: 1, original_split_present: true,
    files: Object.fromEntries([...contents].map(([path, value]) => [path, sha256(value)])),
  }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
}
