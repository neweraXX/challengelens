import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asOf } from "../src/evidence/as-of.js";
import { sportsEvidence } from "../src/evidence/sports.js";
import { parsePriceWindow, scanPrice } from "../src/evidence/price.js";
import type { PriceEvidence, PriceWindow } from "../src/evidence/price.js";
import { EvidenceCollector, attachEvidence } from "../src/evidence/collect.js";
import { decide, evaluateGate } from "../src/gate/decide.js";
import { appendReppo, cacheKey, createReceipt, persistReceipt } from "../src/gate/receipt.js";
import { evidenceHash, inputHash } from "../src/packets/canonical.js";
import { assertModelInputs } from "../src/judge/dev-data.js";
import { actionMetrics } from "../src/gate/metrics.js";
import { reviewPolicy } from "../src/reppo/policy.js";
import type { CaseLabel, ModelInputs } from "../src/packets/types.js";
import type { Verdict } from "../src/judge/schema.js";

const t = "2025-09-17T03:36:14.500Z";
const sports = sportsEvidence({ id: "game1", slug: "game", ended: true, finishedTimestamp: t, score: "5-0", period: "FT" }, "2026-01-01T00:00:00Z")!;
const inputs = (title = "Will Solana reach $250 September 15-21?", rules_text = "Binance prices between September 15, 2025 at 12:00 AM ET and September 21, 2025 at 11:59 PM ET."): ModelInputs => ({ title, rules_text, proposal_time_utc: t,
  proposed_value: "1000000000000000000", gamma_scheduling: { provenance: "CURRENT_GAMMA_METADATA_MAY_DIFFER_FROM_HISTORY", market: { endDate: "2025-09-22T04:00:00Z" }, events: [] } });
const verdict = (decision: Verdict["decision"] = "SUPPORTED_NOW", time: string | null = t): Verdict => ({ decision, reason: decision === "NOT_SUPPORTED_NOW" ? "PREMATURE" : null, decisive_time_utc: time,
  checks: { timing: { status: decision === "SUPPORTED_NOW" ? "PASS" : decision === "NOT_SUPPORTED_NOW" ? "FAIL" : "UNKNOWN", clause_quote: "game", explanation: "The observation is complete." } } });
const price: PriceEvidence = { kind: "price_touch", source: "binance_klines_1m", symbol: "SOLUSDT", target: 250, direction: "high", window_start_utc: "2025-09-15T00:00:00Z", scanned_until_utc: "2025-09-22T00:00:00Z", first_touch_utc: t, candles_scanned: 200 };

test("asOf sports truth table excludes future timestamps and scores", () => {
  assert.deepEqual(asOf(sports, t), { game_finished: true, finished_utc: t, source: sports.source });
  // Feed lag: 1 ms (or 30 min) before the feed's final mark is inside the lag window → no evidence either way.
  assert.equal(asOf(sports, "2025-09-17T03:36:14.499Z"), undefined);
  assert.equal(asOf(sports, "2025-09-17T03:06:14.500Z"), undefined);
  assert.deepEqual(asOf(sports, "2025-09-17T03:06:14.499Z"), { game_finished: false, feed_final_delay_minutes: 30 + 1 / 60_000, source: sports.source });
  assert.equal(asOf({ ...sports, ended: false, finished_utc: null, fetched_at: "2025-09-17T03:41:14.500Z" }, t), undefined);
  assert.deepEqual(asOf({ ...sports, ended: false, finished_utc: null, period: "1", fetched_at: "2025-09-17T04:07:00Z" }, t), { game_finished: false, source: sports.source });
  assert.equal(asOf({ ...sports, ended: false, finished_utc: null, fetched_at: "2025-01-01T00:00:00Z" }, t), undefined);
  assert.equal(asOf({ ...sports, finished_utc: null }, t), undefined);
  assert.equal(asOf(null, t), undefined); assert.equal(asOf(sports, "invalid"), undefined);
});
test("asOf price truth table respects full coverage and first-touch close time", () => {
  assert.equal(asOf(price, t) && "event_occurred" in asOf(price, t)! && (asOf(price, t) as { event_occurred: boolean }).event_occurred, true);
  assert.deepEqual(asOf(price, "2025-09-17T00:00:00Z"), { event_occurred: false, scanned_until_utc: "2025-09-17T00:00:00.000Z", source: price.source });
  assert.equal(asOf({ ...price, scanned_until_utc: "2025-09-16T00:00:00Z", first_touch_utc: null }, t), undefined);
  assert.equal(asOf(price, "2025-09-14T00:00:00Z"), undefined);
  assert.equal(asOf({ ...price, first_touch_utc: null }, t)?.source, price.source);
  assert.equal(asOf({ ...price, first_touch_utc: "2025-09-14T00:00:00Z" }, t), undefined);
});
test("real-looking price titles parse supported assets, directions and date windows conservatively", () => {
  assert.deepEqual(parsePriceWindow(inputs()), { symbol: "SOLUSDT", target: 250, direction: "high", window_start_utc: "2025-09-15T04:00:00.000Z", window_end_utc: "2025-09-22T04:00:00.000Z" });
  const month = { ...inputs("Will Bitcoin dip to $60,000 in November?", "Uses Binance intramonth lows in UTC."), gamma_scheduling: { ...inputs().gamma_scheduling, market: { endDate: "2025-12-01T00:00:00Z" } } };
  assert.equal(parsePriceWindow(month)?.window_start_utc, "2025-11-01T00:00:00.000Z");
  assert.equal(parsePriceWindow(month)?.window_end_utc, "2025-12-01T00:00:00.000Z");
  assert.equal(parsePriceWindow(inputs(undefined, "Uses Binance from September 15, 2025 at 12:00 AM to September 21, 2025 at 11:59 PM ET."))?.window_start_utc, "2025-09-15T04:00:00.000Z");
  assert.equal(parsePriceWindow(month)?.target, 60000); assert.equal(parsePriceWindow(month)?.direction, "low");
  for (const asset of ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA", "LINK", "AVAX", "SUI"]) assert.equal(parsePriceWindow(inputs(`Will ${asset} hit $250 September 15-21?`))?.symbol, `${asset}USDT`);
  assert.equal(parsePriceWindow(inputs("Will Pepe reach $250 September 15-21?")), null);
  assert.equal(parsePriceWindow(inputs("Will Bitcoin or Ethereum reach $250 September 15-21?")), null);
  assert.equal(parsePriceWindow(inputs("Will Bitcoin reach $250k September 15-21?")), null);
  assert.equal(parsePriceWindow(inputs(undefined, inputs().rules_text + " Uses BTCUSDT.")), null);
  assert.equal(parsePriceWindow(inputs(undefined, inputs().rules_text + " Uses the closing price.")), null);
  assert.equal(parsePriceWindow(inputs(undefined, "A different exchange determines this.")), null);
  assert.equal(parsePriceWindow(inputs(undefined, "Binance prices in September.")), null);
});
const start = Date.parse("2025-09-15T00:00:00Z");
test("title-range price parsing preserves the real first-date/last-date rules phrasing", () => {
  const result = parsePriceWindow(inputs("Will Solana reach $250 September 15-21?",
    "Binance prices during the date range specified in the title (from 12:00 AM ET on the first date to 11:59 PM ET on the last)."));
  assert.equal(result?.window_start_utc, "2025-09-15T04:00:00.000Z");
  assert.equal(result?.window_end_utc, "2025-09-22T04:00:00.000Z");
});
const window: PriceWindow = { symbol: "SOLUSDT", target: 250, direction: "high", window_start_utc: new Date(start).toISOString(), window_end_utc: new Date(start + 3_600_000).toISOString() };
const candle = (open: number, span: number, high: number) => [open, "240", String(high), "230", "240", "0", open + span - 1];
test("scanner refines the first candidate hour and uses touching minute CLOSE", async () => {
  const calls: URL[] = []; const waits: number[] = [];
  const result = await scanPrice(window, window.window_end_utc, async (url) => {
    const u = new URL(url); calls.push(u);
    return u.searchParams.get("interval") === "1h" ? [candle(start, 3_600_000, 251)] : [candle(start, 60_000, 249), candle(start + 60_000, 60_000, 250)];
  }, async (ms) => { waits.push(ms); });
  assert.equal(result.first_touch_utc, new Date(start + 119999).toISOString());
  assert.equal(result.candles_scanned, 3); assert.equal(calls.length, 2); assert.deepEqual(waits, [250]);
  assert.equal(asOf(result, new Date(start + 119998).toISOString()), undefined);
});
test("scanner no-touch coverage, gaps, low direction and request bound", async () => {
  const result = await scanPrice(window, window.window_end_utc, async () => [candle(start, 3_600_000, 249)], async () => {});
  assert.equal(result.first_touch_utc, null); assert.equal(result.scanned_until_utc, new Date(start + 3_599_999).toISOString());
  assert.equal((asOf(result, result.scanned_until_utc) as { event_occurred: boolean }).event_occurred, false);
  const gap = await scanPrice(window, window.window_end_utc, async () => [candle(start + 3_600_000, 3_600_000, 240)], async () => {});
  assert.equal(asOf(gap, new Date(start + 1000).toISOString()), undefined);
  let requests = 0;
  await scanPrice({ ...window, window_end_utc: new Date(start + 100 * 3_600_000).toISOString() }, new Date(start + 100 * 3_600_000).toISOString(), async (url) => {
    requests++; return [candle(Number(new URL(url).searchParams.get("startTime")), 3_600_000, 240)];
  }, async () => {});
  assert.equal(requests, 40);
  const low = await scanPrice({ ...window, target: 230, direction: "low" }, window.window_end_utc, async (url) => [candle(start, new URL(url).searchParams.get("interval") === "1h" ? 3_600_000 : 60_000, 250)], async () => {});
  assert.equal(low.first_touch_utc, new Date(start + 59_999).toISOString());
});
test("injected Gamma collection preserves exact identity; unsupported asset makes zero requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "k1-evidence-")); let calls = 0;
  const collector = new EvidenceCollector({ text: async (url) => { calls++; return JSON.stringify(new URL(url).pathname === "/markets" ? { id: "123", events: [{ slug: "game" }] } : [{ slug: "game", id: "game1", ended: true, finishedTimestamp: t }]); }, close: async () => {} }, root, () => Date.parse(t));
  try {
    assert.equal(await collector.collect({ model_inputs: inputs("Will Pepe hit $250 September 15-21?") }), null); assert.equal(calls, 0);
    const packet = { model_inputs: { ...inputs("MLB: A vs B", "Winner of this MLB game."), gamma_scheduling: { ...inputs().gamma_scheduling, market: { id: "123" } } } };
    assert.equal((await collector.collect(packet))?.kind, "sports_feed"); assert.equal(calls, 2);
    await collector.collect(packet); assert.equal(calls, 2);
    const wrong = new EvidenceCollector({ text: async () => JSON.stringify({ id: "wrong", events: [] }), close: async () => {} }, root, () => Date.parse(t));
    await assert.rejects(wrong.collect({ model_inputs: { ...packet.model_inputs, gamma_scheduling: { ...packet.model_inputs.gamma_scheduling, market: { id: "456" } } } }), /identity mismatch/u);
    const byEvent = new EvidenceCollector({ text: async (url) => { assert.ok(url.endsWith("/events/789")); return JSON.stringify({ id: "789", ended: true, finishedTimestamp: t }); }, close: async () => {} }, root, () => Date.parse(t));
    assert.equal((await byEvent.collect({ model_inputs: { ...packet.model_inputs, gamma_scheduling: { ...packet.model_inputs.gamma_scheduling, market: {} } }, event_group: "event:id:789" }))?.kind, "sports_feed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("historical evidence uses the Gamma list-by-id endpoint with embedded events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "k4-embedded-")); let calls = 0;
  const collector = new EvidenceCollector({ text: async (url) => {
    calls++; const parsed = new URL(url); assert.equal(parsed.pathname, "/markets"); assert.equal(parsed.searchParams.get("id"), "123");
    return JSON.stringify([{ id: "123", events: [{ id: "game", ended: true, finishedTimestamp: t, score: "5-0", period: "FT" }] }]);
  }, close: async () => {} }, directory, () => Date.parse(t));
  try {
    const packet = { model_inputs: { ...inputs("MLB: A vs B", "Winner of this MLB game."), gamma_scheduling: { ...inputs().gamma_scheduling, market: { id: "123" } } } };
    const result = await collector.collect(packet);
    assert.equal(calls, 1); assert.equal(result?.kind, "sports_feed");
    assert.deepEqual(Object.keys(result!).sort(), ["kind", "source", "event_id", "slug", "ended", "finished_utc", "score", "period", "fetched_at"].sort());
  } finally { await collector.close(); await rm(directory, { recursive: true, force: true }); }
});
test("gate-v3 requires SERV; sports feed overrides stale starts and estimates", () => {
  const code = { template: "crypto_instant" as const, cutoff_utc: t, matched_text: "price", notes: [] };
  for (const decision of ["NOT_SUPPORTED_NOW", "INSUFFICIENT_EVIDENCE"] as const) {
    const held = decide(verdict(decision), code, t, "0"); assert.equal(held.action, "NEED_EVIDENCE"); assert.equal(held.gate.gate_reason, "SERV did not approve");
  }
  const sport = { ...inputs("MLB: A vs B", "Winner of this MLB game."), gamma_scheduling: { ...inputs().gamma_scheduling, market: { gameStartTime: "2025-09-20T00:00:00Z" } } };
  const proved = { ...sport, evidence_as_of_proposal: asOf(sports, t)! };
  assert.equal(evaluateGate(proved, verdict()).action, "PROCEED");
  assert.equal(evaluateGate(proved, verdict("INSUFFICIENT_EVIDENCE")).action, "NEED_EVIDENCE");
  // gate-v5: SERV approval + feed proof is enough; SERV need not restate the feed timestamp.
  assert.equal(evaluateGate(proved, verdict("SUPPORTED_NOW", "2025-09-17T03:33:00Z")).action, "PROCEED");
  const early = evaluateGate({ ...proved, evidence_as_of_proposal: { game_finished: false, source: "polymarket_gamma_event" } }, verdict());
  assert.equal(early.action, "WAIT"); assert.match(early.gate.gate_reason, /negative inference/u);
  assert.equal(evaluateGate(sport, verdict()).gate.gate_reason, "before sports start");
  const yes = { ...inputs(), evidence_as_of_proposal: asOf(price, t)! };
  assert.equal(evaluateGate(yes, verdict()).action, "PROCEED");
  assert.equal(evaluateGate({ ...yes, evidence_as_of_proposal: { event_occurred: false, scanned_until_utc: t, source: "binance_klines_1m" } }, verdict()).action, "WAIT");
  assert.equal(decide(verdict(), code, "2025-09-16T00:00:00Z", "0").earliest_utc, t);
});
test("packet identity remains original while evidence keys change cache and receipts", () => {
  const original = inputs(); const packet = { case_id: "one", packet_hash: inputHash(original), model_inputs: original };
  const attached = attachEvidence([packet], [{ case_id: "one", packet_hash: packet.packet_hash, evidence: price, error: null }])[0]!;
  assert.doesNotThrow(() => assertModelInputs(attached.model_inputs));
  assert.throws(() => assertModelInputs({ ...original, evidence_as_of_proposal: { game_finished: false, finished_utc: "2026-01-01T00:00:00Z", source: "polymarket_gamma_event" } }));
  assert.throws(() => assertModelInputs({ ...original, evidence_as_of_proposal: { game_finished: true, finished_utc: "2026-01-01T00:00:00Z", source: "polymarket_gamma_event" } }));
  assert.equal(attached.packet_hash, inputHash(original)); assert.notEqual(evidenceHash(attached.model_inputs), evidenceHash(original));
  assert.notEqual(cacheKey(packet.packet_hash, t, "test", evidenceHash(original)), cacheKey(packet.packet_hash, t, "test", evidenceHash(attached.model_inputs)));
  assert.throws(() => attachEvidence([packet], [{ case_id: "one", packet_hash: "wrong", evidence: price, error: null }]));
});
test("review below 70 holds PROCEED in the persisted receipt and preserves both values", async () => {
  assert.equal(reviewPolicy("SUPPORTED_NOW", { route: "review", decision: "accept", score: 70 }).action, "PROCEED");
  const directory = await mkdtemp(join(tmpdir(), "k1-hold-"));
  try {
    const base = createReceipt({ ...decide(verdict(), { template: "crypto_instant", cutoff_utc: t, matched_text: "price", notes: [] }, t, "0"), packet_hash: "a".repeat(64), case_id: "one", market_id: "1", proposal_time_utc: t, model: "test", serv_request_id: null, serv_verdict: verdict() });
    await persistReceipt(base, directory);
    const held = await appendReppo(base.receipt_id, { eval_id: "eval-test", score: 69, route: "review", decision: "accept", confidence: "high", reason: "Review", completed_at: t, evaluated_receipt_sha256: base.receipt_sha256 }, directory);
    assert.equal(held.action, "HOLD_FOR_REVIEW"); assert.equal(held.final_decision, "INSUFFICIENT_EVIDENCE");
    assert.equal(held.original_gate_decision?.action, "PROCEED"); assert.equal(held.held_gate_decision?.gate.gate_reason, "held by independent review");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("action metrics use case denominators, include missing majorities, and separate precision trials", () => {
  const labels = new Map([ ["ok", { case_id: "ok", label: "TIMING_OK" }], ["early", { case_id: "early", label: "PREMATURE" }] ] as [string, CaseLabel][]);
  const rows = ["PROCEED", "PROCEED", "WAIT"].map((action) => ({ case_id: "ok", action }));
  const metrics = actionMetrics([{ case_id: "ok" }, { case_id: "early" }], rows, labels);
  assert.equal(metrics["Proceed precision"].total, 2); assert.equal(metrics["Proceed precision"].case_interval.total, 1);
  assert.equal(metrics["Proceed coverage"].count, 1); assert.equal(metrics["Safe on too-early"].count, 0); assert.equal(metrics["Safe on too-early"].total, 1);
});
