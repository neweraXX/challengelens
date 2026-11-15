import { MarketExamples } from "./examples.js";
import { LiveDesk } from "../live/runtime.js";
import { servSlots } from "../live/serv-limit.js";
import { proceedNeeds, describeNeeds } from "../gate/needs.js";
import { originAllowed } from "./origin.js";
import { EvidenceCollector } from "../evidence/collect.js";
import { asOf } from "../evidence/as-of.js";
import type { Evidence } from "../evidence/as-of.js";
import { evidenceHash } from "../packets/canonical.js";
import { SecondOpinions } from "../reppo/service.js";
import { ReppoError } from "../reppo/client.js";
import { reviewPolicy } from "../reppo/policy.js";
import { GammaLiveClient } from "../collect/gamma.js";
import { PublicHttp } from "../collect/http.js";
import { assessLive, buildLivePacket, LiveError, liveTimeline, minuteTime } from "../demo/live.js";
import type { LivePacket } from "../demo/live.js";
import type { Verdict } from "../judge/schema.js";
import express from "express";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MODELS } from "../judge/client.js";
import { GATE_VERSION, evaluateGate } from "../gate/decide.js";
import { cacheKey, createReceipt, persistReceipt, readReceipt, receiptHash } from "../gate/receipt.js";
import type { Receipt } from "../gate/receipt.js";
import { PROCEDURE_SHA256, PROCEDURE_VERSION } from "../judge/prompt.js";
import { checkWithServ, validateDemoVerdict } from "../demo/serv.js";
import { clauseOffsets } from "../demo/math.js";
import type { ShowcaseCase } from "../demo/types.js";


const app = express();
const publicData = resolve("web/dist/data");
const cacheDir = resolve(process.env.APP_CACHE_DIR ?? ".cache/app");
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "2kb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
  next();
});

// This process reads only generated public artifacts. No dataset/eval paths.
const cases = JSON.parse(await readFile(resolve(publicData, "showcase.json"), "utf8")) as ShowcaseCase[];
const caseById = new Map(cases.map((item) => [item.case_id, item]));
app.get("/api/stats", (_request, response, next) => {
  response.sendFile(resolve(publicData, "stats.json"), (error) => { if (error) next(error); });
});
app.get("/api/cases", (_request, response) => {
  response.json(cases.map(({ case_id, title, category, proposal_time_utc, bond, currency }) =>
    ({ case_id, title, category, proposal_time_utc, bond, currency })));
});
app.get("/api/cases/:id", (request, response) => {
  const item = caseById.get(request.params.id);
  if (!item) { response.status(404).json({ error: "Case not found" }); return; }
  const needs = item.needs ?? (item.gate && item.action ? proceedNeeds({ action: item.action, gate: item.gate, ...(item.earliest_utc ? { earliest_utc: item.earliest_utc } : {}) }) : ["NEED_CUTOFF_READING"]);
  response.json({ ...item, needs, need_details: describeNeeds(needs, item.earliest_utc), serv_verdict: item.verdict, source_tag: "Historical replay" });
});

// No payment layer: the demo is free; per-request limits and caps are applied below.
function reserveServSlot() { servSlots.reserve(); }
function sameOrigin(request: express.Request, response: express.Response): boolean {
  if (!originAllowed(request)) {
    response.status(403).json({ error: "Use this demo's own origin" }); return false;
  }
  return true;
}
function liveFailure(error: unknown, response: express.Response) {
  const status = error instanceof LiveError ? error.status : 502;
  if (error instanceof LiveError && error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
  response.status(status).json({ error: error instanceof LiveError ? error.message : "Upstream check failed. Retry shortly.", retry_after: error instanceof LiveError ? error.retryAfter : 0 });
}
const publicHttp = new PublicHttp();
const evidenceCollector = new EvidenceCollector();
const gamma = new GammaLiveClient((url) => publicHttp.text(url));
const memoryCache = new Map<string, Receipt>();
const pending = new Map<string, Promise<Receipt>>();
const secondOpinions = new SecondOpinions();
const unsupportedCache = new Map<string, Receipt>();
const liveDesk = new LiveDesk();
void liveDesk.load().catch(() => {});
if (process.env.LIVE_DESK === "1") liveDesk.start();
// Single-attempt, no-redirect transport keeps each refresh to at most 12 Gamma HTTP requests.
// Reuse the intake resolver's identity checks, event expansion, cache and rate limiter.
const examplesHttp = new PublicHttp({ quiet: true, attempts: 1, redirects: 0, timeoutMs: 10_000 });
const examplesGamma = new GammaLiveClient((url) => examplesHttp.text(url));
const marketExamples = new MarketExamples({ resolve: (url) => examplesGamma.resolve(url), snapshot: () => liveDesk.latest(),
  fallback: async () => JSON.parse(await readFile(resolve(publicData, "examples.json"), "utf8")) as unknown });
app.get("/api/examples", async (request, response) => {
  if (!sameOrigin(request, response)) return;
  try {
    response.setHeader("Cache-Control", "no-store"); // The server coalesces and caches refreshes for ten minutes.
    response.json(await marketExamples.get());
  } catch (error) { liveFailure(error, response); }
});
app.get("/api/live", (_request, response) => { response.json({ ...liveDesk.latest(), enabled: process.env.LIVE_DESK === "1" }); });
app.get("/api/live/export/:proposal_id", async (request, response) => {
  try { const bundle = await liveDesk.exportProposal(request.params.proposal_id); if (!bundle) { response.status(404).json({ error: "Proposal not found" }); return; } response.json(bundle); }
  catch { response.status(500).json({ error: "Export unavailable" }); }
});
app.get("/api/live/history", (_request, response) => { response.json(liveDesk.historySummary()); });
function needsPayload(receipt: Receipt) {
  const needs = receipt.needs ?? proceedNeeds(receipt);
  return { needs, need_details: describeNeeds(needs, receipt.earliest_utc) };
}
function rememberReceipt(key: string, receipt: Receipt) {
  if (memoryCache.size >= 500) memoryCache.delete(memoryCache.keys().next().value!);
  memoryCache.set(key, receipt);
}
for (const item of cases) {
  const receipt = item.receipt;
  // Keep historical receipts retrievable/reviewable even after a gate upgrade.
  if (receipt && receiptHash(receipt) === receipt.receipt_sha256 && receipt.packet_hash === item.packet_hash && receipt.case_id === item.case_id) await persistReceipt(receipt);
  if (receipt && receipt.model === MODELS.serv && receiptHash(receipt) === receipt.receipt_sha256 &&
      cacheKey(receipt.packet_hash, receipt.proposal_time_utc, receipt.model, receipt.evidence_hash) === cacheKey(item.packet_hash, item.proposal_time_utc, MODELS.serv, evidenceHash({ evidence_as_of_proposal: asOf(item.evidence, item.proposal_time_utc) })) &&
      receipt.procedure_sha256 === PROCEDURE_SHA256 && receipt.gate_version === GATE_VERSION) {
    await persistReceipt(receipt);
    rememberReceipt(cacheKey(item.packet_hash, item.proposal_time_utc, MODELS.serv, receipt.evidence_hash), receipt);
  }
}
app.get("/api/receipts/:id", async (request, response) => {
  try {
    const receipt = await readReceipt(request.params.id);
    if (!receipt) { response.status(404).json({ error: "Receipt not found" }); return; }
    response.json(receipt);
  } catch { response.status(500).json({ error: "Receipt could not be verified" }); }
});

async function cachedCheck(item: Pick<ShowcaseCase, "case_id" | "packet_hash" | "rules_text" | "model_inputs"> & { live_packet?: LivePacket; evidence?: Evidence | null }, time: string): Promise<{ verdict: Verdict; receipt: Receipt; cached: boolean }> {
  const { evidence_as_of_proposal: _oldEvidence, ...originalInputs } = item.model_inputs;
  const evidence = item.evidence ?? null;
  const view = asOf(evidence, time);
  const inputs = { ...originalInputs, proposal_time_utc: time, ...(view ? { evidence_as_of_proposal: view } : {}) };
  const hash = evidenceHash(inputs);
  const key = cacheKey(item.packet_hash, time, MODELS.serv, hash);
  const wrap = async (saved: Receipt, cached: boolean) => {
    const receipt = await readReceipt(saved.receipt_id) ?? saved;
    if (!receipt.serv_verdict) throw new Error("Missing SERV verdict");
    return { verdict: receipt.serv_verdict, receipt, cached };
  };
  const known = memoryCache.get(key);
  if (known) { await persistReceipt(known); return wrap(known, true); }
  const path = resolve(cacheDir, `${key}.json`);
  try {
    const receipt = JSON.parse(await readFile(path, "utf8")) as Receipt;
    validateDemoVerdict(receipt.serv_verdict, item.rules_text);
    if (receiptHash(receipt) !== receipt.receipt_sha256 || receipt.procedure_sha256 !== PROCEDURE_SHA256 || receipt.gate_version !== GATE_VERSION ||
        receipt.evidence_hash !== hash || receipt.model !== MODELS.serv || receipt.packet_hash !== item.packet_hash || receipt.proposal_time_utc !== time) throw new Error("Cache identity mismatch");
    await persistReceipt(receipt);
    rememberReceipt(key, receipt);
    return wrap(receipt, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid persisted cache");
  }
  const running = pending.get(key);
  if (running) return wrap(await running, true);
  const task = (async () => {
    let requestId: string | null = null;
    reserveServSlot();
    const verdict = await checkWithServ(inputs, async (attempt) => { requestId = attempt.serv_request_id ?? null; });
    const receipt = createReceipt({ evidence, evidence_hash: hash, packet_hash: item.packet_hash, case_id: item.case_id, market_id: inputs.gamma_scheduling.market.id ?? null,
      proposal_time_utc: time, model: MODELS.serv, serv_request_id: requestId, serv_verdict: verdict, serv_called: true, ...(item.live_packet ? { live_packet: item.live_packet } : {}), ...evaluateGate(inputs, verdict) });
    // Retain paid responses even if persistence fails; a later hit retries the receipt write.
    rememberReceipt(key, receipt);
    await persistReceipt(receipt);
    await mkdir(cacheDir, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
    await rename(temporary, path);
    rememberReceipt(key, receipt);
    return receipt;
  })();
  pending.set(key, task);
  try { return wrap(await task, false); }
  finally { pending.delete(key); }
}

app.post("/api/check", async (request, response) => {
  if (!sameOrigin(request, response)) return;
  const body: unknown = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) { response.status(400).json({ error: "Expected case_id and optional proposal_time_utc" }); return; }
  const values = body as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "case_id" && key !== "proposal_time_utc") || typeof values.case_id !== "string") {
    response.status(400).json({ error: "Expected case_id and optional proposal_time_utc" }); return;
  }
  const item = caseById.get(values.case_id);
  if (!item) { response.status(404).json({ error: "Case not found" }); return; }
  const supplied = values.proposal_time_utc === undefined ? item.proposal_time_utc : values.proposal_time_utc;
  if (typeof supplied !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(supplied) || !Number.isFinite(Date.parse(supplied)) ||
      new Date(supplied).toISOString().slice(0, 19) !== supplied.slice(0, 19)) {
    response.status(400).json({ error: "proposal_time_utc must be an ISO 8601 UTC timestamp ending in Z" }); return;
  }
  const time = new Date(supplied).toISOString();
  try {
    const result = await cachedCheck(item, time);
    response.json({ ...result, serv_verdict: result.verdict, source_tag: result.cached ? "Cached SERV check" : "Fresh SERV check", final_reason: result.receipt.final_reason, gate: result.receipt.gate, ...(result.receipt.earliest_utc ? { earliest_utc: result.receipt.earliest_utc } : {}), proposal_time_utc: time, procedure: PROCEDURE_VERSION,
      clause_offsets: clauseOffsets(item.rules_text, result.verdict.checks.timing.clause_quote), evidence: result.receipt.evidence ?? null, evidence_as_of_proposal: result.receipt.evidence_as_of_proposal ?? null, ...reviewPolicy(result.receipt.final_decision, result.receipt.reppo, result.receipt.action), ...needsPayload(result.receipt) });
  } catch (error) { liveFailure(error, response); }
});
app.post("/api/market/resolve", async (request, response) => {
  if (!sameOrigin(request, response)) return;
  try {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "url") || !("url" in body)) throw new LiveError("Expected { url }.");
    response.json(await gamma.resolve(body.url));
  } catch (error) { liveFailure(error, response); }
});
app.post("/api/market/check", async (request, response) => {
  if (!sameOrigin(request, response)) return;
  try {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["market_id", "proposed_side", "check_time_utc"].includes(key))) throw new LiveError("Expected market_id, proposed_side, and optional check_time_utc.");
    const values = body as Record<string, unknown>;
    if (values.proposed_side !== "YES" && values.proposed_side !== "NO" && !(typeof values.proposed_side === "number" && Number.isInteger(values.proposed_side) && values.proposed_side >= 0)) throw new LiveError("proposed_side must be YES, NO, or an outcome index.");
    const time = minuteTime(values.check_time_utc);
    const { market, fetched_at } = await gamma.market(values.market_id);
    const packet = buildLivePacket(market, values.proposed_side, time, fetched_at);
    const evidence = packet.fixed_time ? await evidenceCollector.collect({ model_inputs: packet.model_inputs }).catch(() => null) : null;
    const assessed = await assessLive(packet, async (live) => cachedCheck({ case_id: `live-${live.market_id}-${live.packet_hash.slice(0, 12)}`, packet_hash: live.packet_hash,
      rules_text: live.model_inputs.rules_text, model_inputs: live.model_inputs, live_packet: live, evidence }, time));
    if (assessed.supported) {
      const checked = assessed.checked; const receipt = checked.receipt;
      const timeline = liveTimeline(packet, checked.verdict, receipt);
      timeline.receipt = receipt; timeline.cached = checked.cached; timeline.serv_called = true;
      response.json({ ...checked, gate: receipt.gate, final_reason: receipt.final_reason, ...(receipt.earliest_utc ? { earliest_utc: receipt.earliest_utc } : {}),
        serv_verdict: checked.verdict, serv_called: true, source: "gamma_live", source_tag: checked.cached ? "Cached SERV check" : "Fresh SERV check",
        packet, rules_source: packet.rules_source, check_time_utc: time, clause_offsets: timeline.clause_offsets, timeline, evidence: receipt.evidence ?? null, evidence_as_of_proposal: receipt.evidence_as_of_proposal ?? null, ...reviewPolicy(receipt.final_decision, receipt.reppo, receipt.action), ...needsPayload(receipt) });
    } else {
      const unsupportedKey = cacheKey(packet.packet_hash, time, "none");
      const known = unsupportedCache.get(unsupportedKey);
      const receipt = known ?? createReceipt({ ...assessed.result, packet_hash: packet.packet_hash, case_id: `live-${packet.market_id}-${packet.packet_hash.slice(0, 12)}`,
        market_id: packet.market_id, proposal_time_utc: time, model: "none", serv_request_id: null, serv_verdict: null, serv_called: false, live_packet: packet });
      await persistReceipt(receipt);
      if (unsupportedCache.size >= 300) unsupportedCache.delete(unsupportedCache.keys().next().value!);
      unsupportedCache.set(unsupportedKey, receipt);
      const timeline = liveTimeline(packet, assessed.verdict, assessed.result); timeline.receipt = receipt; timeline.serv_called = false; timeline.cached = Boolean(known);
      response.json({ ...assessed.result, verdict: assessed.verdict, serv_verdict: null, serv_called: false, receipt, cached: Boolean(known), source: "gamma_live",
        source_tag: "No SERV call (unsupported)", packet, rules_source: packet.rules_source, check_time_utc: time, clause_offsets: timeline.clause_offsets, timeline, evidence: receipt.evidence ?? null, evidence_as_of_proposal: receipt.evidence_as_of_proposal ?? null, ...reviewPolicy(receipt.final_decision, receipt.reppo, receipt.action), ...needsPayload(receipt) });
    }
  } catch (error) { liveFailure(error, response); }
});
function reppoFailure(error: unknown, response: express.Response) {
  if (error instanceof ReppoError && error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
  response.status(error instanceof ReppoError ? error.status : 502).json({ error: error instanceof ReppoError ? error.message : "Independent review could not be completed." });
}
app.post("/api/second-opinion", async (request, response) => {
  if (!sameOrigin(request, response)) return;
  try {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("receipt_id" in body) || typeof body.receipt_id !== "string") throw new ReppoError("Expected { receipt_id }.", 400, true);
    const receipt = await readReceipt(body.receipt_id);
    if (!receipt) { response.status(404).json({ error: "Receipt not found" }); return; }
    const historical = caseById.get(receipt.case_id);
    const original = receipt.live_packet?.model_inputs ?? (historical?.packet_hash === receipt.packet_hash ? historical.model_inputs : null);
    if (!original) throw new ReppoError("Exact market input for this receipt is unavailable.", 422, true);
    const { evidence_as_of_proposal: _originalEvidence, ...reviewOriginal } = original;
    const job = await secondOpinions.submit(receipt, { ...receipt, model_inputs: { ...reviewOriginal, proposal_time_utc: receipt.proposal_time_utc, ...(receipt.evidence_as_of_proposal ? { evidence_as_of_proposal: receipt.evidence_as_of_proposal } : {}) },
      ...(receipt.live_packet ? { proposed_side: receipt.live_packet.outcomes[receipt.live_packet.proposed_outcome_index] ?? receipt.live_packet.model_inputs.proposed_value } : {}) });
    response.status(202).json({ eval_id: job.eval_id, status: job.status, created_at: job.created_at, evaluated_receipt_sha256: job.evaluated_receipt_sha256 });
  } catch (error) { reppoFailure(error, response); }
});
app.get("/api/second-opinion/:eval_id", async (request, response) => {
  try {
    const job = await secondOpinions.status(request.params.eval_id);
    if (!job) { response.status(404).json({ error: "Evaluation not found" }); return; }
    const receipt = await readReceipt(job.receipt_id);
    response.json({ ...job, ...(receipt ? { receipt, evidence: receipt.evidence ?? null, evidence_as_of_proposal: receipt.evidence_as_of_proposal ?? null, ...reviewPolicy(receipt.final_decision, receipt.reppo, receipt.action), ...needsPayload(receipt) } : {}) });
  } catch (error) { reppoFailure(error, response); }
});
// /api is also the public API documentation screen; preserve direct reloads.
app.get("/api", (_request, response) => { response.sendFile(resolve("web/dist/index.html")); });
app.use("/api", (_request, response) => { response.status(404).json({ error: "Unknown API endpoint" }); });
app.use(express.static(resolve("web/dist"), { index: false }));
app.get("*", (_request, response) => { response.sendFile(resolve("web/dist/index.html")); });
app.use((error: { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(error.status === 400 || error.status === 413 ? error.status : 500).json({ error: "Request could not be processed" });
});
app.listen(8080, "0.0.0.0", () => { console.log("ChallengeLens listening on :8080"); });
