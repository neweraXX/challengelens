"""Kokoro ONNX, CPU, offline. Cache identity includes all synthesis inputs."""
import hashlib
import json
import os
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path('/video')
CACHE = ROOT / 'cache/audio'


def main():
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    if os.environ.get('TTS_ENGINE', 'kokoro') != 'kokoro':
        raise ValueError('Only TTS_ENGINE=kokoro is implemented.')
    voice = os.environ.get('TTS_VOICE', 'af_heart')
    speed = float(os.environ.get('TTS_SPEED', '0.98'))
    if not 0.7 <= speed <= 1.3:
        raise ValueError('TTS_SPEED must be between 0.7 and 1.3.')
    CACHE.mkdir(parents=True, exist_ok=True)
    script = json.loads((ROOT / 'narration.json').read_text())
    only = os.environ.get('SCENE_ONLY')
    selected = [beat for beat in script if not only or beat['id'] == only]
    if not selected:
        raise ValueError(f'Unknown SCENE_ONLY={only}; choose ' + ', '.join(beat['id'] for beat in script))
    totals = (json.loads((ROOT / 'cache/live.json').read_text())['totals']
              if any('{{' in beat['text'] for beat in selected) else {})
    def number(value):
        # Match the UI's en-US maximumFractionDigits: 2, retaining bond cents.
        amount = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return f'{amount:,.2f}'.rstrip('0').rstrip('.')

    variables = {key: number(value) for key, value in totals.items()
                 if isinstance(value, (int, float)) and not isinstance(value, bool)}
    if totals:
        variables['bond_usdc'] = number(totals['bond_in_liveness_usdc'])
        if totals.get('truncated'):
            # The desk hit its collection cap: these figures are lower bounds, say so.
            variables['in_liveness'] = 'at least ' + variables['in_liveness']
            variables['bond_usdc'] = 'at least ' + variables['bond_usdc']
        # Counts drift by a few between narration and recording while proposals arrive and expire: say "about".
        for key in ('on_time_by_feed', 'serv_read', 'no_key'):
            if key in variables: variables[key] = 'about ' + variables[key]
        if not totals.get('truncated'):
            variables['in_liveness'] = 'about ' + variables['in_liveness']
            variables['bond_usdc'] = 'about ' + variables['bond_usdc']
        variables['flagged'] = ('no proposals flagged' if totals['flagged'] == 0
                                else f'{number(totals["flagged"])} proposals flagged')
    models = Path('/opt/recorder/models')
    fingerprints = json.loads((models / 'sha256.json').read_text())
    model = None
    beats = []
    ids = set()
    for beat in selected:
        started = time.monotonic()
        ident = beat['id']
        if not re.fullmatch(r'[a-z][a-z0-9_-]*', ident) or ident in ids:
            raise ValueError(f'Invalid/duplicate beat ID: {ident}')
        ids.add(ident)

        def fill(match):
            name = match.group(1)
            if name not in variables:
                raise ValueError(f'Beat {ident}: missing live variable {name}')
            return variables[name]

        text = re.sub(r'\{\{([a-z_]+)\}\}', fill, beat['text'])
        if '{{' in text or '}}' in text:
            raise ValueError(f'Unresolved template in {ident}')
        identity = json.dumps(dict(text=text, voice=voice, speed=speed, engine='kokoro-onnx-0.4.9',
                                   models=fingerprints, format='mono-24000-peak-3db-tail120ms-v1'), sort_keys=True)
        digest = hashlib.sha256(identity.encode()).hexdigest()
        cached = CACHE / f'{ident}-{digest}.wav'
        if not cached.exists():
            if model is None:
                print('[tts] loading Kokoro ONNX (CPU); no network', flush=True)
                model = Kokoro(str(models / 'kokoro-v1.0.onnx'), str(models / 'voices-v1.0.bin'))
            print(f'[tts] synthesize {ident}: {len(text.split())} words', flush=True)
            samples, rate = model.create(text, voice=voice, speed=speed, lang='en-us')
            samples = np.asarray(samples, dtype=np.float32)
            if rate != 24000 or samples.ndim != 1 or not np.isfinite(samples).all():
                raise ValueError(f'{ident}: expected finite 24 kHz mono output; got {rate}, {samples.shape}')
            audible = np.flatnonzero(np.abs(samples) > 0.001)
            if not audible.size:
                raise ValueError(f'{ident}: TTS returned silence')
            # Keep 30 ms of breath at either edge, then append exactly 120 ms.
            samples = samples[max(0, audible[0] - 720):min(len(samples), audible[-1] + 721)]
            samples *= (10 ** (-3 / 20)) / float(np.max(np.abs(samples)))
            samples = np.concatenate([samples, np.zeros(2880, dtype=np.float32)])
            temp = cached.with_suffix('.tmp.wav')
            sf.write(str(temp), samples, 24000, subtype='PCM_16')
            temp.replace(cached)
        info = sf.info(str(cached))
        if info.samplerate != 24000 or info.channels != 1 or info.duration <= 0.12:
            raise ValueError(f'{ident}: invalid cached WAV; delete {cached} and rerun')
        target = CACHE / f'{ident}.wav'
        shutil.copyfile(cached, target)
        beats.append(dict(id=ident, scene=beat['scene'], text=text, hash=digest,
                          duration=info.duration, speech_duration=info.duration - 0.12,
                          audio=f'audio/{ident}.wav'))
        print(f'[tts] {ident}: {info.duration:.3f}s hash={digest[:12]} elapsed={time.monotonic()-started:.1f}s', flush=True)
    manifest = dict(version=1, sample_rate=24000, voice=voice, speed=speed,
                    models=fingerprints, beats=beats, total_audio_seconds=sum(b['duration'] for b in beats))
    temp = CACHE / 'durations.tmp.json'
    temp.write_text(json.dumps(manifest, indent=2) + '\n')
    temp.replace(CACHE / 'durations.json')
    print(f'[tts] total speech + tails: {manifest["total_audio_seconds"]:.2f}s', flush=True)
    if not os.environ.get('SCENE_ONLY') and not 130 <= manifest['total_audio_seconds'] <= 164:
        raise ValueError('Speech budget must be 130–164s for a 140–170s film. Adjust TTS_SPEED, then rerun; never truncate narration.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'[tts] FAILED: {error}', file=sys.stderr, flush=True)
        raise

# TODO only: TTS_ENGINE=piper could be a future fallback. Not implemented.
