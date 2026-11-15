import { writeFile } from 'node:fs/promises';

try {
  const response = await fetch('http://app:8080/api/live', {
    signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`GET /api/live: HTTP ${response.status}`);
  const snapshot = await response.json();
  if (!snapshot.totals || !snapshot.generated_at || snapshot.stale || snapshot.enabled !== true)
    throw new Error('Live desk needs a fresh, enabled, successful cycle. Start the app with LIVE_DESK=1 and wait.');
  // A truncated snapshot (collection cap reached) is a lower bound; the narration says "at least" instead of failing.
  for (const name of ['in_liveness', 'bond_in_liveness_usdc', 'on_time_by_feed', 'serv_read', 'flagged', 'no_key']) {
    if (!Number.isFinite(snapshot.totals[name]) || snapshot.totals[name] < 0)
      throw new Error(`Missing/invalid live total: ${name}`);
  }
  await writeFile('/video/cache/live.json', JSON.stringify({ ...snapshot, video_fetched_at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`[live] snapshot=${snapshot.generated_at} totals=${JSON.stringify(snapshot.totals)}`);
} catch (error) {
  console.error(`[live] FAILED: ${error.message}. Verify app:8080 on challengelens_default.`);
  process.exitCode = 1;
}
