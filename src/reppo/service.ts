import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { appendReppo } from "../gate/receipt.js";
import type { Receipt } from "../gate/receipt.js";
import { formatReppoInput } from "./format.js";
import type { ReviewInput } from "./format.js";
import { POLL_TIMEOUT_MS, ReppoClient, ReppoError, validEvalId } from "./client.js";
import type { ReppoEvaluation, ReppoStatus } from "./client.js";
import type { ReppoSummary } from "./policy.js";

export interface ReviewJob {
  eval_id: string; receipt_id: string; evaluated_receipt_sha256: string; status: ReppoStatus; created_at: string; updated_at: string;
  evaluation?: ReppoEvaluation; polling_timed_out?: boolean; error?: string;
}
interface Reservation { receipt_id: string; evaluated_receipt_sha256: string; created_at: string; submission_state: "RESERVED" | "UNCERTAIN" }
interface Ledger { day: string; count: number; last_submission_at: number }
interface Client { submit(input: string): Promise<ReppoEvaluation>; get(id: string): Promise<ReppoEvaluation>; poll(id: string, update: (e: ReppoEvaluation) => Promise<void>, timeout: number): Promise<ReppoEvaluation> }
export class SecondOpinions {
  private client: Client | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly polling = new Set<string>();
  private readonly checkedAt = new Map<string, number>();
  constructor(private readonly directory = ".cache/reppo", private readonly receiptDirectory = ".cache/receipts", private readonly clientFactory: () => Client = () => new ReppoClient(), private readonly dailyCap = Number(process.env.REPPO_DAILY_CAP ?? 30)) {
    if (!Number.isSafeInteger(dailyCap) || dailyCap < 0) throw new Error("REPPO_DAILY_CAP must be an nonnegative safe integer");
  }
  private api() { return this.client ??= this.clientFactory(); }
  private async json<T>(name: string): Promise<T | null> {
    try {
      const value: unknown = JSON.parse(await readFile(resolve(this.directory, name), "utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid stored state");
      return value as T;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new ReppoError("Stored Reppo state could not be verified.", 503); }
  }
  private async save(name: string, value: unknown) {
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, name); const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); await rename(temp, path);
  }
  private async saveJob(job: ReviewJob) {
    await this.save(`receipt-${job.evaluated_receipt_sha256}.json`, job);
    await this.save(`eval-${job.eval_id}.json`, job);
  }
  async submit(receipt: Receipt, input: ReviewInput): Promise<ReviewJob> {
    // The first reviewed hash remains the identity even after the receipt gains
    // its reppo extension and therefore a new canonical receipt_sha256.
    const hash = receipt.reppo?.evaluated_receipt_sha256 ?? receipt.receipt_sha256;
    if (!/^[0-9a-f]{64}$/u.test(hash)) throw new ReppoError("Invalid receipt digest.", 400);
    const task = this.lock.catch(() => {}).then(async () => {
      const existing = await this.json<ReviewJob | Reservation>(`receipt-${hash}.json`);
      if (existing && "eval_id" in existing) {
        if (existing.status === "COMPLETED") await this.complete(existing); else this.startPolling(existing);
        return existing;
      }
      if (receipt.reppo) {
        // The receipt itself is durable proof of a completed paid review, even
        // if an index was lost. Rebuild it; never buy that review again.
        const r = receipt.reppo;
        if (!validEvalId(r.eval_id)) throw new ReppoError("Stored evaluation ID is invalid.", 503);
        const recovered = await this.json<ReviewJob>(`eval-${r.eval_id}.json`);
        const job: ReviewJob = recovered ?? { eval_id: r.eval_id, receipt_id: receipt.receipt_id, evaluated_receipt_sha256: hash, status: "COMPLETED", created_at: r.completed_at, updated_at: r.completed_at,
          evaluation: { id: r.eval_id, status: "COMPLETED", score: r.score, route: r.route, result: { decision: r.decision, confidence: r.confidence, reason: r.reason, rubric_scores: null, consensus: null, explain: null } } };
        await this.saveJob(job); return job;
      }
      if (existing) throw new ReppoError("A submission is already reserved for this receipt. Its outcome must be reconciled before any retry.", 409);
      const formatted = formatReppoInput(input); const api = this.api(); // Missing keys never reserve credit.
      const now = Date.now(); const day = new Date(now).toISOString().slice(0, 10);
      const ledger = await this.json<Ledger>("ledger.json") ?? { day, count: 0, last_submission_at: 0 };
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(ledger.day) || !Number.isSafeInteger(ledger.count) || ledger.count < 0 || !Number.isFinite(ledger.last_submission_at) || ledger.last_submission_at < 0) throw new ReppoError("Stored Reppo budget ledger is invalid; no submission sent.", 503, true);
      if (now - ledger.last_submission_at < 20_000) throw new ReppoError("One new Reppo submission every 20 seconds globally.", 429, true, Math.ceil((20_000 - (now - ledger.last_submission_at)) / 1000));
      const count = ledger.day === day ? ledger.count : 0;
      if (count >= this.dailyCap) throw new ReppoError("Daily Reppo submission cap reached.", 429, true, Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now) / 1000));
      // Single app instance. Persist reservations and the UTC-day attempt count
      // BEFORE HTTP. Ambiguous transport failures can never silently double-bill.
      await this.save("ledger.json", { day, count: count + 1, last_submission_at: now });
      const reservation: Reservation = { receipt_id: receipt.receipt_id, evaluated_receipt_sha256: hash, created_at: new Date(now).toISOString(), submission_state: "RESERVED" };
      await this.save(`receipt-${hash}.json`, reservation);
      let evaluation: ReppoEvaluation;
      try { evaluation = await api.submit(formatted); }
      catch (error) {
        if (error instanceof ReppoError && error.notQueued) await unlink(resolve(this.directory, `receipt-${hash}.json`));
        else await this.save(`receipt-${hash}.json`, { ...reservation, submission_state: "UNCERTAIN" });
        throw error;
      }
      const job: ReviewJob = { eval_id: evaluation.id, receipt_id: receipt.receipt_id, evaluated_receipt_sha256: hash, status: evaluation.status,
        created_at: reservation.created_at, updated_at: new Date().toISOString(), evaluation };
      await this.saveJob(job);
      if (evaluation.status === "COMPLETED") await this.complete(job);
      else this.startPolling(job);
      return job;
    });
    this.lock = task;
    return task;
  }
  private async complete(job: ReviewJob) {
    const e = job.evaluation;
    if (e?.status !== "COMPLETED" || e.score === undefined || !e.route || !e.result) return;
    const summary: ReppoSummary = { eval_id: job.eval_id, score: e.score, route: e.route, decision: e.result.decision, confidence: e.result.confidence,
      reason: e.result.reason, completed_at: job.updated_at, evaluated_receipt_sha256: job.evaluated_receipt_sha256 };
    await appendReppo(job.receipt_id, summary, this.receiptDirectory);
  }
  private startPolling(job: ReviewJob) {
    if (job.status === "COMPLETED" || job.status === "FAILED" || this.polling.has(job.eval_id) || job.polling_timed_out) return;
    const remaining = POLL_TIMEOUT_MS - (Date.now() - Date.parse(job.created_at));
    if (remaining <= 0) return;
    this.polling.add(job.eval_id);
    void (async () => {
      try {
        await this.api().poll(job.eval_id, async (evaluation) => {
          job.evaluation = evaluation; job.status = evaluation.status; job.updated_at = new Date().toISOString(); delete job.error;
          if (job.status === "COMPLETED") { job.polling_timed_out = false; delete job.error; }
      await this.saveJob(job); if (job.status === "COMPLETED") await this.complete(job);
        }, remaining);
      } catch (error) {
        job.polling_timed_out = true;
        job.error = error instanceof ReppoError && error.status === 504 ? "Polling timed out. Refresh this evaluation later; it will not be resubmitted." : "Status polling stopped. Refresh this evaluation later; it will not be resubmitted.";
        await this.saveJob(job);
      } finally { this.polling.delete(job.eval_id); }
    })().catch(() => { this.polling.delete(job.eval_id); }); // Never log keys, bodies, or transport exceptions.
  }
  async status(id: string): Promise<ReviewJob | null> {
    if (!validEvalId(id)) return null;
    const job = await this.json<ReviewJob>(`eval-${id}.json`); if (!job) return null;
    // A review that finished after an earlier polling timeout is simply complete: drop the stale timeout state.
    if (job.status === "COMPLETED") { if (job.polling_timed_out || job.error) { job.polling_timed_out = false; delete job.error; await this.saveJob(job); } await this.complete(job); return job; }
    if (job.status === "FAILED") return job;
    if (Date.now() - Date.parse(job.created_at) >= POLL_TIMEOUT_MS) job.polling_timed_out = true;
    if (job.polling_timed_out && !this.polling.has(id) && Date.now() - (this.checkedAt.get(id) ?? 0) >= 5000) {
      this.checkedAt.set(id, Date.now());
      const evaluation = await this.api().get(id);
      job.evaluation = evaluation; job.status = evaluation.status; job.updated_at = new Date().toISOString();
      if (job.status === "COMPLETED") { job.polling_timed_out = false; delete job.error; }
      await this.saveJob(job); if (job.status === "COMPLETED") await this.complete(job);
    } else this.startPolling(job);
    return job;
  }
}
