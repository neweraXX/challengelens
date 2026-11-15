"""Build-time downloads only. No runtime model or voice downloads."""
import hashlib
import json
import pathlib
import time
import urllib.request

root = pathlib.Path('/opt/recorder/models')
root.mkdir(parents=True, exist_ok=True)
base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
manifest = {}
for name in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
    path = root / name
    for attempt in range(1, 4):
        try:
            print(f'[models] download {name}, attempt {attempt}/3', flush=True)
            with urllib.request.urlopen(base + name, timeout=180) as source, path.open('wb') as target:
                while block := source.read(1024 * 1024):
                    target.write(block)
            if path.stat().st_size < 1_000_000:
                raise RuntimeError(f'{name}: unexpectedly small file')
            break
        except Exception as error:
            if attempt == 3:
                raise RuntimeError(f'Model download failed: {base + name}: {error}') from error
            time.sleep(attempt * 2)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest[name] = digest
    print(f'[models] SHA256 {digest}  {name}', flush=True)
(root / 'sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
