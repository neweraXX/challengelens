import { createHash } from "node:crypto";

// Sort object keys recursively; preserve array order. Only JSON values are allowed.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Canonical JSON received a non-JSON value.");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function inputHash(inputs: unknown): string {
  return sha256(canonicalJson(inputs));
}

/** Hash the independent evidence key separately from the original packet identity. */
export function evidenceHash(inputs: { evidence_as_of_proposal?: unknown }): string {
  return inputHash(inputs.evidence_as_of_proposal ?? null);
}
