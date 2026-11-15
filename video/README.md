# ChallengeLens demo video

Nine scripted beats, offline Kokoro neural narration (`af_heart`), measured scene
timings, burned-in captions, 1440×900 / 30 fps H.264 and AAC. The full export must
be **2:20–2:50**; speech is never truncated to fit. All fetching, synthesis,
recording and rendering run inside one Docker image. The host script only builds,
creates output directories and launches the container.

From `challengelens/`, with the app already built and configured:

```sh
dc() { docker compose -f compose.web.yml "$@"; }
dc up -d app
video/run.sh
```

The app must be reachable at `http://app:8080` on `challengelens_default`, with
fresh Live collection enabled, working SERV checks and the saved 52-point Reppo
hold. Only the **app** needs its existing integration configuration. The video
container takes no keys, mounts only `video/` read-only plus `out/` and `cache/`
read-write, drops all capabilities and runs as the host UID/GID (1000 when the
host UID is root). Those directories must be writable by that user. Docker BUILD
needs download access; recorder browser requests are restricted to `app:8080`.
Upstream calls remain the app's responsibility.

```sh
VIDEO_HOSTED_URL=https://your-app.example \
VIDEO_REPO_URL=https://github.com/your-org/your-repo \
video/run.sh

# Single-beat debugging; skips the full-film duration/dead-air limits.
SCENE_ONLY=braves video/run.sh
```

Environment: `VIDEO_HOSTED_URL`, `VIDEO_REPO_URL` (otherwise “links in the
submission”); `TTS_VOICE=af_heart`, `TTS_SPEED=0.98`, `TTS_ENGINE=kokoro`;
`SCENE_ONLY=intro|home|live|check|braves|benchmark|limits|reppo|outro`.
The video link always says “links in the submission”.
`TTS_ENGINE=piper` is a future fallback TODO, **not implemented**.

Outputs: `video/out/challengelens-demo.mp4`, `captions.srt`, `narration.txt`,
`pipeline.log`, stream metadata, `live-recorded.json` and `check-selection.json`.
Single scenes use `challengelens-demo-<id>.mp4` and share the latest caption/log
files. They synthesize only that beat and need a Live snapshot only for `live`.
Failed scenes produce `out/debug/<id>.png` and `.txt`; raw WebM paths are
logged. A failed run never replaces the last successful MP4. Cached WAVs and
durations, the measured timeline, raw captures, sync and loudness measurements
live in `video/cache/`. Delete old raw captures there when disk space is needed.
Do not run two pipelines against the same output/cache directories concurrently.

This records the app **running locally**. Live numbers are fetched from
`/api/live` immediately before synthesis, formatted with thousands separators,
and compared with the real response during the Live shot. The page shows its
actual snapshot timestamp. Changed totals, stale/paused/truncated collection,
unsupported/closed Bitcoin examples, missing Reppo holds, cached Braves readings,
or a Braves result other than Proceed cause a clear non-zero failure. “Need
evidence” on a supported Bitcoin check is a valid outcome. No new Reppo evaluation
is submitted. Braves uses the timeline's displayed feed mark; each attempt is
remembered in `cache/braves-attempts.json` so another run chooses an unused minute
without deleting app receipts/caches. Brief SERV rate limits retry at most twice.
The Benchmark feedback card is the app's published `procedures/changes.jsonl`
record via `/data/reppo-loop.json`; no sealed dataset is mounted or opened.

Audio caches include resolved text, voice, speed, model SHA-256 and normalization
settings. Python pins are `kokoro-onnx==0.4.9`, `soundfile==0.12.1`,
`numpy==2.2.6`; Node Playwright matches the base image at `1.49.1`. Model URLs
are the Kokoro `model-files-v1.0` release's `kokoro-v1.0.onnx` and
`voices-v1.0.bin`; build logs print their SHA-256 values and retain a manifest.
These are recorded fingerprints, not comparisons against a separately trusted
checksum. The base tag, apt packages and transitive packages are not digest/lock
pinned, so the recipe is reproducible operationally, not byte-for-byte.

The recorder adds a smooth visible cursor, local-recording label and reserved
126-pixel caption band without modifying app sources. A black synchronization
leader is removed automatically. Captions use proportional word timing within
each measured speech window, not forced phoneme alignment. Audio is peak-scaled
to −3 dB with 120 ms trailing silence, then mixed on a digital-silence base and
normalized in two passes to −16 LUFS. No music or room tone.

Initial handoff is statically checked only: Docker and network were unavailable.
Verify package availability, the two model URLs, Kokoro's `af_heart`/`en-us`
support and visible selectors on the built app. The defaults enforce the final
duration and reject actions that extend more than 1.9 seconds past speech;
if a timing check fails, inspect service latency and the logged audio durations.
Adjust `TTS_SPEED` and rerun if needed. No credentials belong in this directory.
