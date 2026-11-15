import test from "node:test";
import assert from "node:assert/strict";
import { assessLive, buildLivePacket, gammaMarket, LIVE_RULES_SOURCE, liveTimeline, minuteTime, parseMarketUrl } from "../src/demo/live.js";
import { GammaLiveClient } from "../src/collect/gamma.js";
import { createReceipt, receiptHash } from "../src/gate/receipt.js";

const fixture = {
  id: "12345", slug: "bitcoin-above-90000", question: "Will Bitcoin be above $90,000 on November 3, 2026 at 12:00 PM ET?",
  description: 'This market resolves to Yes if the price of Bitcoin at November 3, 2026 at 12:00 PM ET is above $90,000. Otherwise No.',
  endDate: "2026-11-03T17:00:00Z", startDate: "2026-11-01T00:00:00Z", active: true, closed: false, outcomes: '["Yes","No"]',
};
const time = "2026-11-03T17:01:22.000Z";
const fetched = "2026-11-03T17:01:00.000Z";

test("Polymarket URL parsing separates event, market, and nested event market slugs", () => {
  assert.deepEqual(parseMarketUrl("https://polymarket.com/event/bitcoin-november?tid=123#details"), { kind: "event", slug: "bitcoin-november", market_slug: null, url: "https://polymarket.com/event/bitcoin-november" });
  assert.equal(parseMarketUrl("https://www.polymarket.com/market/bitcoin-above-90000/").kind, "market");
  assert.equal(parseMarketUrl("https://polymarket.com/event/bitcoin-november/bitcoin-above-90000").market_slug, "bitcoin-above-90000");
  for (const value of ["https://evil.test/event/test", "https://polymarket.com.evil.test/event/test", "https://evil.polymarket.com/event/test", "http://polymarket.com/event/test", "https://u:p@polymarket.com/event/test", "https://polymarket.com:8443/event/test", "https://polymarket.com/profile/test", "https://polymarket.com/event/a%2Fb", "https://polymarket.com/event/", "https://polymarket.com/market/test/extra", "file:///event/test"]) assert.throws(() => parseMarketUrl(value), value);
});
test("live packet uses Gamma question/description, provenance, scheduling, and side mapping", () => {
  const market = gammaMarket(fixture, { id: "event1", gameStartTime: "2026-11-03T16:00:00Z" });
  const packet = buildLivePacket(market, "NO", time, fetched);
  assert.equal(packet.source, "gamma_live");
  assert.equal(packet.rules_source, LIVE_RULES_SOURCE);
  assert.match(packet.rules_source, /not onchain ancillary bytes/u);
  assert.equal(packet.fetched_at, fetched);
  assert.equal(packet.market_id, fixture.id);
  assert.equal(packet.model_inputs.rules_text, `${fixture.question}\n\n${fixture.description}`);
  assert.equal(packet.model_inputs.gamma_scheduling.market.endDate, fixture.endDate);
  assert.equal(packet.model_inputs.gamma_scheduling.events[0]!.gameStartTime, "2026-11-03T16:00:00Z");
  assert.equal(packet.model_inputs.proposal_time_utc, "2026-11-03T17:01:00.000Z");
  assert.equal(packet.model_inputs.proposed_value, "0");
  assert.equal(packet.fixed_time?.kind, "crypto_instant");
  assert.equal(packet.packet_hash.length, 64);
  const reversed = gammaMarket({ ...fixture, outcomes: ["No", "Yes"] });
  assert.equal(buildLivePacket(reversed, 1, time, fetched).model_inputs.proposed_value, "1000000000000000000");
  assert.equal(buildLivePacket(reversed, 0, time, fetched).model_inputs.proposed_value, "0");
});
test("packet cache identity includes outcome, rules, scheduling, and rounded minute, excluding fetched_at", () => {
  const market = gammaMarket(fixture);
  const base = buildLivePacket(market, "NO", time, fetched);
  assert.equal(base.packet_hash, buildLivePacket(market, 1, "2026-11-03T17:01:59Z", "2026-11-03T17:01:30Z").packet_hash);
  assert.notEqual(base.packet_hash, buildLivePacket(market, "YES", time, fetched).packet_hash);
  assert.notEqual(base.packet_hash, buildLivePacket(gammaMarket({ ...fixture, description: fixture.description + " Updated rule." }), "NO", time, fetched).packet_hash);
  assert.notEqual(base.packet_hash, buildLivePacket(gammaMarket({ ...fixture, gameStartTime: "2026-11-03T18:00:00Z" }), "NO", time, fetched).packet_hash);
  assert.notEqual(base.packet_hash, buildLivePacket(market, "NO", "2026-11-03T17:02:00Z", fetched).packet_hash);
  assert.throws(() => minuteTime("2026-02-30T12:00:00Z"));
  assert.equal(minuteTime(undefined, Date.parse(time)), "2026-11-03T17:01:00.000Z");
});
test("unsupported families short-circuit with zero SERV calls and an explicit receipt", async () => {
  let calls = 0;
  const market = gammaMarket({ ...fixture, question: "Will a candidate win the election?", description: "This resolves when the election is certified." });
  const packet = buildLivePacket(market, "YES", time, fetched);
  const result = await assessLive(packet, async () => { calls += 1; return "not reached"; });
  assert.equal(calls, 0); assert.equal(result.supported, false);
  if (result.supported) assert.fail("Unsupported market reached SERV");
  assert.equal(result.result.final_decision, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.result.gate.gate_reason, "market type not supported yet");
  const receipt = createReceipt({ ...result.result, case_id: "live-test", market_id: market.id, packet_hash: packet.packet_hash, proposal_time_utc: packet.model_inputs.proposal_time_utc,
    model: "none", serv_verdict: null, serv_called: false, serv_request_id: null, live_packet: packet });
  assert.equal(receipt.serv_verdict, null); assert.equal(receiptHash(receipt), receipt.receipt_sha256);
  const timeline = liveTimeline(packet, result.verdict, result.result);
  assert.equal(timeline.source, "gamma_live"); assert.equal(timeline.settlement_label, null); assert.equal(timeline.proposal_tx_hash, null);
});
test("supported packet uses exactly one injected check; named/multiple outcomes fail closed when asymmetric", async () => {
  let calls = 0;
  const supported = await assessLive(buildLivePacket(gammaMarket(fixture), "NO", time, fetched), async () => { calls += 1; return "checked"; });
  assert.equal(calls, 1); assert.equal(supported.supported, true);
  const multi = buildLivePacket(gammaMarket({ ...fixture, outcomes: ["Yes", "No", "Other"] }), 2, time, fetched);
  await assessLive(multi, async () => { calls += 1; return "not reached"; });
  assert.equal(calls, 1); assert.equal(multi.fixed_time, null);
  assert.throws(() => buildLivePacket(gammaMarket(fixture), 2, time, fetched));
});
test("Gamma resolve validates exact slug identity and caches event markets for sixty seconds", async () => {
  let now = Date.parse(fetched); let calls = 0;
  const gamma = new GammaLiveClient(async (url) => {
    calls += 1;
    assert.equal(new URL(url).hostname, "gamma-api.polymarket.com");
    return new URL(url).pathname.startsWith("/markets/") ? JSON.stringify(fixture) : JSON.stringify([{ slug: "bitcoin-november", markets: [fixture], gameStartTime: "2026-11-03T16:00:00Z" }]);
  }, () => now);
  const first = await gamma.resolve("https://polymarket.com/event/bitcoin-november");
  await gamma.resolve("https://polymarket.com/event/bitcoin-november");
  await gamma.market("12345");
  assert.equal(calls, 1); assert.equal(first.markets[0]!.id, "12345");
  assert.equal(first.markets[0]!.scheduling.events[0]!.gameStartTime, "2026-11-03T16:00:00Z");
  now += 60_001; await gamma.market("12345"); assert.equal(calls, 2);
  const wrong = new GammaLiveClient(async () => JSON.stringify([{ ...fixture, slug: "wrong-slug" }]));
  await assert.rejects(wrong.resolve("https://polymarket.com/market/bitcoin-above-90000"), /No unique/u);
});
