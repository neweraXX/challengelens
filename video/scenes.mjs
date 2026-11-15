import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const require = createRequire('/opt/recorder/package.json');
const { chromium } = require('playwright');
const ROOT = '/video';
const ORIGIN = 'http://app:8080';
const BRAVES = 'timing-1cb1c22e47ea5596f03eb22a';
const ETHEREUM = 'timing-4cfe8694807a8ed7a250f376';
let browser, context, page, currentBeat, epoch, beatStart, video;
const timeline = { version: 1, width: 1440, height: 900, beats: [] };
const log = (message) => console.log(`[scenes] ${message}`);
const sleep = (ms) => page.waitForTimeout(Math.max(0, ms));
const readJSON = async (name) => JSON.parse(await readFile(name, 'utf8'));
const saveTimeline = () => writeFile(`${ROOT}/cache/timeline.json`, JSON.stringify(timeline, null, 2) + '\n');

// Runs on every app navigation; the recorder owns these overlays, not app code.
function installPresentation() {
  if (window.location.pathname === '/__video_sync__') return;
  const install = () => {
    if (document.getElementById('video-cursor')) return;
    const style = document.createElement('style');
    style.textContent = `html{scroll-padding-top:100px;scroll-padding-bottom:160px}
      body{padding-bottom:150px!important}
      #video-cursor{position:fixed;left:0;top:0;width:18px;height:24px;background:#172f3c;
        clip-path:polygon(0 0,0 91%,27% 66%,45% 100%,62% 92%,45% 60%,82% 60%);
        pointer-events:none;z-index:2147483646;transform:translate(1320px,110px)}
      #video-caption-safe{position:fixed;bottom:0;left:0;right:0;height:126px;background:#e9eff1;
        border-top:1px solid #bfccd1;z-index:2147483645;pointer-events:none}
      #video-label{position:fixed;right:18px;top:72px;background:#f8fafbee;color:#425b69;
        padding:5px 9px;font:11px Inter,sans-serif;z-index:2147483644;pointer-events:none;border:1px solid #bfccd1}`;
    document.head.append(style);
    const cursor = document.createElement('div'); cursor.id = 'video-cursor';
    const safe = document.createElement('div'); safe.id = 'video-caption-safe';
    const label = document.createElement('div'); label.id = 'video-label'; label.textContent = 'Recorded locally · live app';
    document.body.append(cursor, safe, label);
    document.addEventListener('mousemove', (event) => { cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`; });
    document.addEventListener('mousedown', () => { cursor.style.background = '#09675b'; });
    document.addEventListener('mouseup', () => { cursor.style.background = '#172f3c'; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}

async function focus(locator, { pause = 450 } = {}) {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
  await sleep(pause + 350);
}

async function point(locator) {
  await focus(locator, { pause: 150 });
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target has no visible bounds');
  const x = box.x + Math.min(box.width / 2, 180);
  const y = box.y + Math.min(box.height / 2, 35);
  // Fixed steps, fixed delays: smooth movement without randomness or jitter.
  const start = await page.evaluate(() => window.__videoMouse ?? { x: 1320, y: 110 });
  for (let i = 1; i <= 16; i++) {
    const fraction = i / 16;
    const eased = fraction * fraction * (3 - 2 * fraction);
    await page.mouse.move(start.x + (x - start.x) * eased, start.y + (y - start.y) * eased);
    await sleep(12);
  }
  await page.evaluate(({ x, y }) => { window.__videoMouse = { x, y }; }, { x, y });
  await sleep(120);
}

async function click(locator) {
  await point(locator);
  await locator.click();
  await sleep(180);
}

async function goto(path) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await page.locator('main').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

// Narration cues are proportional word positions, not hard-coded wall times.
async function cue(phrase) {
  const index = currentBeat.text.indexOf(phrase);
  if (index < 0) throw new Error(`Missing narration cue: ${phrase}`);
  const wordsBefore = currentBeat.text.slice(0, index).trim().split(/\s+/).filter(Boolean).length;
  const words = currentBeat.text.split(/\s+/).length;
  await sleep(beatStart + currentBeat.speech_duration * 1000 * wordsBefore / words - performance.now());
}

async function requestViaButton(button, path) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    // Register immediately before the actual click, after scrolling and pointing.
    await point(button);
    const [response] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === 'POST', { timeout: 25_000 }),
      button.click(),
    ]);
    const data = await response.json();
    if (response.ok()) return data;
    const message = String(data.error ?? `HTTP ${response.status()}`);
    if (attempt < 12 && (response.status() === 429 || /retry shortly/i.test(message))) {
      const seconds = Math.max(3.2, Number(data.retry_after ?? response.headers()['retry-after']) || 3.2);
      if (seconds > 15) throw new Error(`Retry delay ${seconds}s exceeds the demo budget: ${message}`);
      log(`SERV busy, attempt ${attempt}/12; retry in ${seconds}s: ${message}`);
      await sleep(seconds * 1000);
    } else throw new Error(`${path}: ${message}`);
  }
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function card(outro = false) {
  const hosted = escapeHTML(process.env.VIDEO_HOSTED_URL || 'links in the submission');
  const repo = escapeHTML(process.env.VIDEO_REPO_URL || 'links in the submission');
  // Inline HTML is still served from app:8080: all UI/API activity shares its origin.
  await page.goto(`${ORIGIN}/__video_card__`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(installPresentation);
  if (outro) await page.locator('#video-cursor').evaluate((element) => { element.style.display = 'none'; });
  await page.locator('#card').evaluate((element, html) => { element.innerHTML = html; }, outro
    ? `<p class="eyebrow">BEFORE THE BOND.</p><h1>ChallengeLens</h1><p class="promise">Inspect the timing. Keep the receipt.</p><dl><dt>Hosted app</dt><dd>${hosted}</dd><dt>Repository</dt><dd>${repo}</dd><dt>Demo video</dt><dd>links in the submission</dd></dl><p class="fine">Timing only · Not financial advice</p>`
    : '<p class="eyebrow">SERV HACKATHON 02 · REPPO + OPEN</p><h1>ChallengeLens</h1><p class="promise">Check proposal timing before the bond.</p><p class="fine">A rule reading. A code cutoff. Event evidence.</p>');
}

async function intro() { await card(); }

async function home() {
  await goto('/');
  await page.locator('.hero-preview h2').waitFor();
  await sleep(2000);
  const section = page.getByRole('heading', { name: 'How it decides', exact: true }).locator('..').locator('..').locator('..');
  await focus(page.getByRole('heading', { name: 'How it decides', exact: true }));
  await click(section.getByRole('button', { name: /Replay/ }));
  await focus(section, { pause: 100 });
  await sleep(9000);
}

async function live() {
  const expected = await readJSON(`${ROOT}/cache/live.json`);
  const liveResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/live' && response.ok());
  await goto('/live');
  const snapshot = await (await liveResponse).json();
  if (!snapshot.generated_at || snapshot.stale || snapshot.enabled !== true || !snapshot.totals)
    throw new Error('Live snapshot became stale, paused or missing; wait for a successful cycle.');
  for (const key of ['in_liveness', 'bond_in_liveness_usdc', 'flagged']) { // the narration quotes only these; other tiles are shown, not spoken
    const was = expected.totals[key], now = snapshot.totals[key];
    // Narration says "about"/"at least" for drifting counts; only a large drift (or any change in flags) invalidates it.
    const tolerance = key === 'flagged' ? 0 : Math.max(3, Math.ceil(0.04 * was));
    if (Math.abs(now - was) > tolerance)
      throw new Error(`Live total ${key} changed after TTS (${expected.totals[key]} → ${snapshot.totals[key]}). Rerun video/run.sh to refresh narration.`);
  }
  await page.locator('.desk-stats strong').first().waitFor();
  await page.locator('#video-label').evaluate((element, time) => { element.textContent = `Recorded locally · live snapshot ${time}`; }, snapshot.generated_at);
  await writeFile(`${ROOT}/out/live-recorded.json`, JSON.stringify(snapshot, null, 2) + '\n');
  await focus(page.getByText('Proposals in the challenge window', { exact: true }));
  await sleep(1800);
  await focus(page.getByRole('heading', { name: 'What the evidence can say' }));
  await sleep(1500);
  await focus(page.getByRole('heading', { name: "Why timing isn’t confirmed", exact: true }));
  const confirmed = page.getByRole('button', { name: /^Confirmed on time ·/ });
  await click(confirmed);
  const row = page.getByRole('row').filter({ has: page.locator('td .desk-chip').filter({ hasText: /Confirmed on time/ }) }).first();
  if (await row.count()) {
    await point(row.getByRole('button').first());
    await sleep(800);
    await click(row.getByRole('button').first());
    const detailID = await row.getByRole('button').first().getAttribute('aria-controls');
    await focus(page.locator(`[id="${detailID}"]`).getByRole('heading').first());
  } else {
    log('No Confirmed on time row in this snapshot; keeping honest empty filter state.');
    await focus(page.getByRole('table').getByText('No proposals match these filters.', { exact: true }).or(page.getByRole('table').getByText(/No proposals are currently/)).first());
  }
}

async function check() {
  await goto('/check');
  const chip = page.getByRole('button', { name: /Bitcoin/i }).first();
  await chip.waitFor();
  const resolution = await requestViaButton(chip, '/api/market/resolve');
  const market = resolution.markets?.find((item) => !item.closed && item.active !== false && item.outcomes?.some((side) => /^yes$/i.test(side)));
  if (!market) throw new Error('First Bitcoin example has no open Yes market. Refresh app examples, then rerun.');
  const select = page.locator('main select').nth(0);
  await point(select);
  await select.selectOption(String(market.id));
  const side = page.locator('main select').nth(1);
  await point(side);
  await side.selectOption(String(market.outcomes.findIndex((value) => /^yes$/i.test(value))));
  const result = await requestViaButton(page.getByRole('button', { name: /^Check timing/ }), '/api/market/check');
  if (result.serv_called === false || !result.receipt) throw new Error('Bitcoin example did not produce a SERV-backed receipt; narration requires a real rule reading.');
  await writeFile(`${ROOT}/out/check-selection.json`, JSON.stringify({ url: await page.getByRole('textbox').first().inputValue(), market_id: market.id, question: market.question, side: 'Yes', action: result.action, receipt_id: result.receipt.receipt_id, recorded_at: new Date().toISOString() }, null, 2) + '\n');
  const verdict = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Three checks' }) });
  await verdict.waitFor();
  await focus(verdict.getByRole('heading', { level: 2 }));
  await sleep(1000);
  await focus(verdict.getByRole('heading', { name: 'Three checks' }));
  await sleep(600);
  await focus(verdict.getByText('Code cutoff', { exact: true }));
}

async function braves() {
  await goto(`/cases/${BRAVES}`);
  const verdict = page.locator('aside[aria-labelledby="verdict-title"]');
  await verdict.waitFor();
  if (await verdict.getAttribute('data-action') !== 'WAIT') throw new Error('Braves original receipt is not Wait.');
  await focus(verdict.getByRole('heading', { level: 2 }));
  const mark = page.locator('.evidence-marker-label time');
  const finalTime = Date.parse(await mark.getAttribute('datetime'));
  if (!Number.isFinite(finalTime)) throw new Error('Braves feed final timestamp missing from the timeline.');
  await focus(page.locator('.evidence-marker-label'));
  await cue('Moving past it');
  const pin = page.getByRole('slider', { name: 'Proposal time', exact: true });
  await point(pin); await pin.focus();
  for (let step = 0; step < 64; step++) {
    const value = Number(await pin.getAttribute('aria-valuenow')) * 60_000;
    if (value > finalTime) break;
    if (value >= Number(await pin.getAttribute('aria-valuemax')) * 60_000) throw new Error('Feed final mark lies beyond the proposal slider range.');
    await pin.press('Shift+ArrowRight'); await sleep(65);
  }
  if (!(Number(await pin.getAttribute('aria-valuenow')) * 60_000 > finalTime)) throw new Error('Failed to move past feed final mark in 64 steps.');
  // Preserve the app's cache and choose a minute this recorder has not attempted.
  // A failed/cached attempt is remembered, so the next run can use the next minute.
  let attempted = [];
  try { attempted = await readJSON(`${ROOT}/cache/braves-attempts.json`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let selected = Number(await pin.getAttribute('aria-valuenow'));
  while (attempted.includes(selected)) {
    if (selected >= Number(await pin.getAttribute('aria-valuemax'))) throw new Error('All remaining Braves proposal minutes attempted; inspect cache/braves-attempts.json.');
    await pin.press('ArrowRight'); await sleep(65);
    selected = Number(await pin.getAttribute('aria-valuenow'));
  }
  attempted.push(selected);
  await writeFile(`${ROOT}/cache/braves-attempts.json`, JSON.stringify(attempted) + '\n');
  // Source currently says Recomputed locally (drag); accept future Local only wording.
  await verdict.getByText(/Recomputed locally \(drag\)|Local only/i).waitFor();
  await cue('Now I request');
  const response = await requestViaButton(verdict.getByRole('button', { name: /Get a fresh SERV reading|Re-check with SERV at this time/ }), '/api/check');
  if (response.cached !== false) throw new Error('Braves returned Cached SERV check; cannot narrate it as fresh. Rerun: this attempted minute is remembered and the next minute will be used, preserving app caches.');
  if (response.action !== 'PROCEED') throw new Error(`Braves fresh check returned ${response.action}; cannot narrate Proceed. Inspect the receipt and evidence.`);
  await verdict.getByText('Fresh SERV check', { exact: true }).waitFor();
  await verdict.getByRole('heading', { name: 'Proceed', exact: true }).waitFor();
  await focus(verdict.getByRole('heading', { name: 'Proceed', exact: true }));
  await sleep(800);
  await click(verdict.getByText('Saved receipt', { exact: true }));
  await focus(verdict.locator('.receipt-details code'));
}

async function benchmark() {
  await goto('/benchmark');
  const heading = page.getByRole('heading', { name: 'What the second key changes', exact: true });
  await focus(heading);
  const strip = page.getByRole('region', { name: /^Blind test on/ });
  await click(strip.getByRole('button', { name: 'SERV alone', exact: true }));
  await focus(strip, { pause: 100 });
  await cue('With checks:');
  await click(strip.getByRole('button', { name: '+ checks', exact: true }));
  await focus(strip, { pause: 100 });
  await sleep(1500);
  await focus(strip.locator('.guardrail-note'));
  const blind = page.locator('.sealed-evidence').filter({ has: page.getByRole('heading', { name: 'Blind test on unseen cases (frozen before unblinding)', exact: true }) });
  await focus(blind.getByRole('heading', { name: 'Dangerous approvals on too-early proposals' }));
  await cue('Checks alone');
  const checksOnly = blind.locator('.sealed-unit-row').filter({ hasText: /Checks only|Code only|no model/i });
  await focus(checksOnly.first());
  await click(blind.getByText('Exact case counts, intervals, actions, tokens and cost', { exact: true }));
  const coverage = blind.getByRole('row').filter({ hasText: '14/32' }).first();
  await coverage.waitFor();
  await focus(coverage);
}

async function limits() {
  if (!page.url().endsWith('/benchmark')) await goto('/benchmark');
  await focus(page.getByRole('heading', { name: 'Limits of this evidence', exact: true }));
  await sleep(1600);
  await focus(page.locator('.site-footer').getByText(/Timing check only; not financial advice/));
}

async function reppo() {
  await goto(`/cases/${ETHEREUM}`);
  const panel = page.getByRole('region', { name: 'Second opinion from Reppo', exact: true });
  await panel.waitFor();
  await panel.locator('.reppo-consequence').filter({ hasText: /52\s*\/\s*100/ }).waitFor({ timeout: 20_000 });
  const savedText = await panel.innerText();
  if (!/on hold after independent review|Held for independent review/i.test(savedText)) throw new Error('Saved Reppo review does not show the real 52-point hold.');
  await focus(panel.getByRole('heading', { name: 'Second opinion (Reppo)', exact: true }));
  await cue('A real Proceed');
  await focus(panel.locator('.reppo-consequence strong'));
  await cue('We added missing context');
  await goto('/benchmark');
  await page.getByRole('heading', { name: 'Reppo feedback loop', exact: true }).waitFor();
  const record = page.getByRole('article').filter({ hasText: /52/ }).filter({ hasText: /69/ }).filter({ hasText: /reppo-format|finalization|context/i }).first();
  await record.waitFor();
  await focus(record.locator('.feedback-heading'));
  await sleep(900);
  await focus(record.locator('.change-metrics').or(record.locator('blockquote')).first());
}

async function outro() {
  await goto('/api');
  await focus(page.getByRole('heading', { name: 'GET /api/live · live timing desk', exact: true }));
  await sleep(1200);
  await cue('The app, source');
  await card(true);
}

const scenes = { intro, home, live, check, braves, benchmark, limits, reppo, outro };

async function main() {
  const audio = await readJSON(`${ROOT}/cache/audio/durations.json`);
  const only = process.env.SCENE_ONLY;
  if (only && !scenes[only]) throw new Error(`Unknown SCENE_ONLY=${only}; choose ${Object.keys(scenes).join(', ')}`);
  const beats = only ? audio.beats.filter((beat) => beat.id === only) : audio.beats;
  if (!beats.length) throw new Error('No audio beats selected.');
  await mkdir(`${ROOT}/cache/raw`, { recursive: true });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 30_000 });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'UTC',
    recordVideo: { dir: `${ROOT}/cache/raw`, size: { width: 1440, height: 900 } } });
  // No recorder egress beyond the app. The app itself owns upstream integrations.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) return route.continue();
    return route.abort('blockedbyclient');
  });
  const cardHTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ChallengeLens · Demo</title><style>
    *{box-sizing:border-box}body{margin:0;background:#e9eff1;color:#172f3c;font-family:Inter,sans-serif}
    #card{margin:150px 120px 0;max-width:1180px;border-left:5px solid #09675b;padding:20px 46px}
    .eyebrow{font-size:14px;letter-spacing:.16em;color:#185469}h1{font-size:92px;letter-spacing:-.065em;line-height:1;margin:28px 0}
    .promise{font-size:32px;margin:20px 0 32px}.fine{font-size:18px;color:#425b69}dl{display:grid;grid-template-columns:150px 1fr;gap:15px;font-size:19px}dt{color:#425b69}dd{margin:0;overflow-wrap:anywhere}
    #card{animation:enter 800ms ease-out both}@keyframes enter{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    </style><body><main id="card"></main></body></html>`;
  await context.route(`${ORIGIN}/__video_card__`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: cardHTML }));
  await context.route(`${ORIGIN}/__video_sync__`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#000;height:100vh"></body></html>' }));
  await context.addInitScript(installPresentation);
  page = await context.newPage(); video = page.video();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => log(`PAGE ERROR: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') log(`browser: ${message.text()}`); });
  // A black leader gives ffmpeg a visible synchronization point independent of
  // Chromium startup time. t_start is relative to the content after this leader.
  await page.goto(`${ORIGIN}/__video_sync__`, { waitUntil: 'load' });
  await sleep(700);
  await page.evaluate(() => { document.body.style.background = '#e9eff1'; });
  epoch = performance.now();
  timeline.started_at = new Date().toISOString();
  timeline.scene_only = only || null;
  for (const beat of beats) {
    currentBeat = beat; beatStart = performance.now();
    const entry = { id: beat.id, scene: beat.scene, t_start: Math.round(beatStart - epoch), audio_duration: beat.duration };
    timeline.beats.push(entry); await saveTimeline();
    log(`BEGIN ${beat.id} at ${entry.t_start}ms, audio ${beat.duration.toFixed(2)}s`);
    await scenes[beat.scene]();
    const actionsSeconds = (performance.now() - beatStart) / 1000;
    // Extra dead air is a production failure, not a silent pacing regression.
    if (!only && actionsSeconds > beat.speech_duration + 1.9)
      throw new Error(`${beat.id}: actions took ${actionsSeconds.toFixed(2)}s, beyond ${beat.speech_duration.toFixed(2)}s speech + 1.9s. Inspect service latency; rerun or revise pacing.`);
    await sleep(beatStart + (beat.duration + 0.4) * 1000 - performance.now());
    entry.t_end = Math.round(performance.now() - epoch);
    entry.actions_seconds = actionsSeconds;
    await saveTimeline();
    log(`END ${beat.id}, scene ${((entry.t_end-entry.t_start)/1000).toFixed(2)}s`);
  }
  timeline.total_ms = Math.round(performance.now() - epoch);
  await saveTimeline();
  await context.close(); context = null;
  const raw = await video.path();
  await writeFile(`${ROOT}/cache/recording.json`, JSON.stringify({ raw, total_ms: timeline.total_ms, sync: 'black-leader-end' }, null, 2) + '\n');
  await browser.close(); browser = null;
  if (!only && (timeline.total_ms < 140_000 || timeline.total_ms > 170_000))
    throw new Error(`Film is ${(timeline.total_ms/1000).toFixed(2)}s; required 140–170s. Adjust TTS_SPEED and rerun.`);
  log(`Recorded ${(timeline.total_ms/1000).toFixed(2)}s → ${raw}`);
}

try { await main(); }
catch (error) {
  console.error(`[scenes] FAILED scene=${currentBeat?.id ?? 'setup'}: ${error.stack ?? error}`);
  if (page && !page.isClosed()) {
    const name = `${ROOT}/out/debug/${currentBeat?.id ?? 'setup'}`;
    await page.screenshot({ path: `${name}.png`, fullPage: true, timeout: 5000 }).catch((error) => log(`Screenshot failed: ${error.message}`));
    await writeFile(`${name}.txt`, `URL: ${page.url()}\n${error.stack ?? error}\n\n${await page.locator('body').innerText().catch(() => '(body unavailable)')}`).catch(() => {});
  }
  if (context) await context.close().catch(() => {});
  if (video) log(`Failed-session WebM: ${await video.path().catch(() => '(unavailable)')}`);
  if (browser) await browser.close().catch(() => {});
  process.exitCode = 1;
}
