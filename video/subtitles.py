"""Caption the exact resolved narration on the measured video timeline."""
import json
from pathlib import Path
import sys

ROOT = Path('/video')


def chunks(text):
    result, lines, line = [], [], ''
    for word in text.split():
        if len(word) > 42:
            raise ValueError(f'Caption word exceeds 42 characters: {word}')
        candidate = f'{line} {word}'.strip()
        if len(candidate) <= 42:
            line = candidate
        else:
            lines.append(line)
            if len(lines) == 2:
                result.append('\n'.join(lines))
                lines = []
            line = word
    if line:
        lines.append(line)
    if lines:
        result.append('\n'.join(lines))
    return result


def stamp(milliseconds):
    value = max(0, round(milliseconds))
    hours, value = divmod(value, 3_600_000)
    minutes, value = divmod(value, 60_000)
    seconds, ms = divmod(value, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{ms:03}'


def main():
    audio = json.loads((ROOT / 'cache/audio/durations.json').read_text())
    timeline = json.loads((ROOT / 'cache/timeline.json').read_text())
    by_id = {beat['id']: beat for beat in audio['beats']}
    captions, transcript = [], []
    previous_end = 0
    for scene in timeline['beats']:
        beat = by_id[scene['id']]
        start = scene['t_start']
        end = start + beat['speech_duration'] * 1000
        if start < previous_end or end > scene['t_end'] + 1:
            raise ValueError(f'{scene["id"]}: narration overlaps another scene or exceeds the scene window')
        parts = chunks(beat['text'])
        weights = [len(part.split()) for part in parts]
        total = sum(weights)
        consumed = 0
        for part, weight in zip(parts, weights):
            left = start + (end - start) * consumed / total
            consumed += weight
            right = start + (end - start) * consumed / total
            captions.append(f'{len(captions)+1}\n{stamp(left)} --> {stamp(right)}\n{part}\n')
        transcript.append(f'[{stamp(start)}] {beat["id"]}\n{beat["text"]}\n')
        previous_end = end
    if not captions:
        raise ValueError('No subtitle cues generated')
    (ROOT / 'out/captions.srt').write_text('\n'.join(captions), encoding='utf-8')
    (ROOT / 'out/narration.txt').write_text('\n'.join(transcript), encoding='utf-8')
    print(f'[subtitles] {len(captions)} cues; maximum two lines × 42 characters; exact resolved speech', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'[subtitles] FAILED: {error}', file=sys.stderr, flush=True)
        raise
