#!/usr/bin/env bash
set -Eeuo pipefail
trap 'code=$?; echo "[video] FAILED at host line $LINENO (exit $code)" >&2; exit "$code"' ERR
VIDEO_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v docker >/dev/null || { echo '[video] Docker is required.' >&2; exit 1; }
mkdir -p "$VIDEO_DIR/out" "$VIDEO_DIR/cache"
SECONDS=0
echo '[video] === build challengelens-video:local ==='
docker build --progress=plain -t challengelens-video:local "$VIDEO_DIR"
echo "[video] build elapsed ${SECONDS}s"
docker network inspect challengelens_default >/dev/null
echo '[video] === run pipeline on challengelens_default ==='
# Match host ownership on Linux and macOS. Non-root execution is the default.
VIDEO_UID="$(id -u)"
VIDEO_GID="$(id -g)"
if [[ "$VIDEO_UID" == 0 ]]; then VIDEO_UID=1000; VIDEO_GID=1000; fi
docker run --rm --init --network challengelens_default \
  --user "$VIDEO_UID:$VIDEO_GID" --cap-drop ALL \
  --security-opt no-new-privileges --read-only --shm-size=1g \
  --tmpfs /tmp:rw,exec,nosuid,size=1g,mode=1777 \
  --mount "type=bind,src=$VIDEO_DIR,dst=/video,readonly" \
  --mount "type=bind,src=$VIDEO_DIR/out,dst=/video/out" \
  --mount "type=bind,src=$VIDEO_DIR/cache,dst=/video/cache" \
  -e "VIDEO_HOSTED_URL=${VIDEO_HOSTED_URL:-}" \
  -e "VIDEO_REPO_URL=${VIDEO_REPO_URL:-}" \
  -e "TTS_VOICE=${TTS_VOICE:-af_heart}" \
  -e "TTS_SPEED=${TTS_SPEED:-0.98}" \
  -e "TTS_ENGINE=${TTS_ENGINE:-kokoro}" \
  -e "SCENE_ONLY=${SCENE_ONLY:-}" \
  challengelens-video:local
echo "[video] complete; total elapsed ${SECONDS}s"
