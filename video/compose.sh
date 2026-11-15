#!/usr/bin/env bash
set -Eeuo pipefail
trap 'code=$?; echo "[compose] FAILED line=$LINENO exit=$code" >&2; exit "$code"' ERR
python3 - <<'PY'
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path('/video')
cache, out = root / 'cache', root / 'out'


def run(arguments, capture=False):
    print('[compose] ' + ' '.join(str(item) for item in arguments), flush=True)
    result = subprocess.run([str(item) for item in arguments], text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if result.returncode:
        if capture:
            print(result.stdout, file=sys.stderr)
            print(result.stderr, file=sys.stderr)
        raise RuntimeError(f'{arguments[0]} exited {result.returncode}')
    return result


try:
    recording = json.loads((cache / 'recording.json').read_text())
    timeline = json.loads((cache / 'timeline.json').read_text())
    audio = json.loads((cache / 'audio/durations.json').read_text())
    raw = Path(recording['raw'])
    if not raw.is_relative_to(cache / 'raw') or not raw.is_file():
        raise ValueError('Missing/invalid raw recording path')
    total = timeline['total_ms'] / 1000
    only = timeline.get('scene_only')
    if not only and not 140 <= total <= 170:
        raise ValueError(f'Duration {total:.2f}s is outside 140–170s')
    if not all('t_end' in scene for scene in timeline['beats']):
        raise ValueError('Timeline contains an unfinished scene')

    # Chromium starts capturing before the first navigation. Measure and remove
    # the black leader, rather than guessing at a browser startup offset.
    detected = run(['ffmpeg', '-hide_banner', '-i', raw, '-t', '5', '-an', '-vf',
                    'blackdetect=d=0.25:pix_th=0.04:pic_th=0.98', '-f', 'null', '-'], capture=True)
    match = re.search(r'black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)', detected.stderr)
    if not match:
        raise ValueError('Cannot locate black synchronization leader; inspect raw WebM. Refusing unsynchronised export.')
    offset = float(match.group(2))
    if not 0.25 <= offset <= 4:
        raise ValueError(f'Unexpected synchronization offset {offset}s')
    print(f'[compose] video synchronization: trim {offset:.3f}s leader', flush=True)
    # Chromium's recorder can run slower than the wall clock while heavy pages render (observed: a 168.3 s session
    # produced a 174.1 s WebM), which makes the picture lag the narration more and more. Stretch it back linearly.
    probe_raw = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', raw], capture=True).stdout)
    span = float(probe_raw['format']['duration']) - offset
    factor = total / span if span > 0 and 0.9 <= total / span <= 1.1 else 1.0
    print(f'[compose] recorder drift: WebM content {span:.2f}s vs wall clock {total:.2f}s; video time factor {factor:.4f}', flush=True)
    (cache / 'sync.json').write_text(json.dumps({'raw_leader_seconds': offset, 'content_seconds': total, 'webm_content_seconds': span, 'drift_factor': factor}, indent=2) + '\n')

    by_id = {beat['id']: beat for beat in audio['beats']}
    arguments = ['ffmpeg', '-hide_banner', '-y', '-f', 'lavfi', '-i', f'anullsrc=r=48000:cl=stereo:d={total:.6f}']
    filters, labels = [], ['[0:a]']
    for index, scene in enumerate(timeline['beats'], 1):
        beat = by_id[scene['id']]
        path = cache / beat['audio']
        if not path.is_relative_to(cache / 'audio') or not path.is_file():
            raise ValueError(f'Missing audio for {scene["id"]}')
        arguments += ['-i', path]
        delay = int(scene['t_start'])
        filters.append(f'[{index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={delay}|{delay}[a{index}]')
        labels.append(f'[a{index}]')
    filters.append(''.join(labels) + f'amix=inputs={len(labels)}:duration=first:normalize=0:dropout_transition=0[mix]')
    mixed = cache / 'mix.wav'
    run(arguments + ['-filter_complex', ';'.join(filters), '-map', '[mix]', '-t', f'{total:.6f}', '-c:a', 'pcm_s24le', mixed])
    analysis = run(['ffmpeg', '-hide_banner', '-i', mixed, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture=True)
    loud = re.search(r'\{\s*"input_i"[\s\S]*?\}', analysis.stderr)
    if not loud:
        raise ValueError('loudnorm did not return measurements')
    measured = json.loads(loud.group(0))
    (cache / 'loudness.json').write_text(json.dumps(measured, indent=2) + '\n')
    for key in ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']:
        if measured[key].lower() in ('-inf', 'inf', 'nan'):
            raise ValueError(f'Invalid loudness {key}: {measured[key]}')
    loudnorm = ('loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:print_format=summary'
                f':measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}'
                f':measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}'
                f':offset={measured["target_offset"]},aresample=48000,aformat=channel_layouts=stereo:sample_rates=48000')
    # Force PlayRes as well as font size, so 26 means 26 pixels at 1440×900.
    style = ('PlayResX=1440,PlayResY=900,Fontname=Inter,Fontsize=26,PrimaryColour=&H00FFFFFF,'
             'OutlineColour=&H803C2F17,BackColour=&H803C2F17,BorderStyle=3,Outline=1,Shadow=0,'
             'MarginV=36,Alignment=2')
    vf = (f'trim=start={offset:.6f}:duration={span:.6f},setpts=(PTS-STARTPTS)*{factor:.6f},fps=30,'
          f"subtitles=filename=/video/out/captions.srt:force_style='{style}'")
    name = f'challengelens-demo-{only}' if only else 'challengelens-demo'
    partial = out / f'{name}.partial.mp4'
    final = out / f'{name}.mp4'
    run(['ffmpeg', '-hide_banner', '-y', '-i', raw, '-i', mixed,
         '-map', '0:v:0', '-map', '1:a:0', '-vf', vf, '-af', loudnorm,
         '-t', f'{total:.6f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
         '-movflags', '+faststart', '-map_metadata', '-1', partial])
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', partial], capture=True).stdout)
    actual = float(probe['format']['duration'])
    visual = next(stream for stream in probe['streams'] if stream['codec_type'] == 'video')
    sound = next(stream for stream in probe['streams'] if stream['codec_type'] == 'audio')
    if (visual['codec_name'] != 'h264' or visual['pix_fmt'] != 'yuv420p'
        or (visual['width'], visual['height']) != (1440, 900) or visual['r_frame_rate'] != '30/1'
        or sound['codec_name'] != 'aac' or abs(actual - total) > 0.15):
        raise ValueError('Final stream validation failed; inspect partial MP4 and ffprobe metadata')
    if not only and not 140 <= actual <= 170:
        raise ValueError(f'Final duration {actual:.3f}s is outside 140–170s')
    (out / f'{name}.metadata.json').write_text(json.dumps(probe, indent=2) + '\n')
    partial.replace(final)
    print(f'[compose] SUCCESS {final}: {actual:.2f}s, {final.stat().st_size:,} bytes ({final.stat().st_size / 1048576:.2f} MiB)', flush=True)
except Exception as error:
    print(f'[compose] FAILED: {error}', file=sys.stderr, flush=True)
    raise
PY
