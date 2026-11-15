#!/usr/bin/env bash
set -Eeuo pipefail
STEP=initialise
trap 'code=$?; echo "[video] FAILED step=$STEP line=$LINENO exit=$code; inspect /video/out/debug and pipeline.log" >&2; exit "$code"' ERR
mkdir -p /video/out/debug /video/cache/audio /video/cache/raw /video/cache/runtime
test -w /video/out && test -w /video/cache
# Keep the previous successful MP4 until a new render passes validation.
rm -f /video/cache/timeline.json /video/cache/recording.json
exec > >(tee /video/out/pipeline.log) 2>&1
step() {
  STEP="$1"; shift
  local started=$SECONDS
  echo "[video] === $STEP ==="
  "$@"
  echo "[video] $STEP elapsed $((SECONDS-started))s"
}
if [[ -z "${SCENE_ONLY:-}" || "${SCENE_ONLY:-}" == live ]]; then
  step live node /video/fetch-live.mjs
else
  echo "[video] === live snapshot not needed for SCENE_ONLY=$SCENE_ONLY ==="
fi
step tts python3 /video/tts.py
step scenes node /video/scenes.mjs
step subtitles python3 /video/subtitles.py
step compose bash /video/compose.sh
