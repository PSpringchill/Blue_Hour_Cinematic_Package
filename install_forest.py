#!/usr/bin/env python3
"""Install tree GLB models into ./trees/ for the in-game forest.

Usage:
    python3 install_forest.py ~/Downloads/spruce.glb ~/Downloads/pine.glb \
        --license CC0

Accepts up to four .glb files. Slots are matched by filename keyword
(spruce, pine, fir, birch); unmatched files fill remaining slots in
order. Missing slots keep the procedural forest. Each installed file is
validated as a GLB, hashed, and recorded in trees/manifest.json.
"""
import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'trees'
SLOTS = ['spruce', 'pine', 'fir', 'birch']
GLB_MAGIC = b'glTF'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('glbs', nargs='+', type=Path,
                        help='up to four .glb tree models')
    parser.add_argument('--license', default='unspecified',
                        help='asset license tag recorded in the manifest')
    ns = parser.parse_args()
    sources = [p.expanduser() for p in ns.glbs[:len(SLOTS)]]

    TARGET.mkdir(exist_ok=True)
    assigned = {}
    for slot in SLOTS:
        hit = next((p for p in sources if slot in p.name.lower()), None)
        if hit:
            assigned[slot] = hit
            sources.remove(hit)
    for slot in SLOTS:
        if slot not in assigned and sources:
            assigned[slot] = sources.pop(0)

    if not assigned:
        print('nothing installed')
        return 1

    manifest_path = TARGET / 'manifest.json'
    manifest = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text())
        except ValueError:
            manifest = {}
    manifest.setdefault('trees', {})

    for slot, src in assigned.items():
        if not src.is_file():
            print(f'skip {src}: not a file')
            continue
        with open(src, 'rb') as fh:
            if fh.read(4) != GLB_MAGIC:
                print(f'skip {src.name}: not a binary glTF (.glb) file')
                continue
        dst = TARGET / f'{slot}.glb'
        shutil.copyfile(src, dst)
        manifest['trees'][slot] = {
            'file': dst.name,
            'source': src.name,
            'license': ns.license,
            'sha256': sha256(dst),
            'installed': time.strftime('%Y-%m-%dT%H:%M:%S%z')
        }
        print(f'{src.name} -> trees/{dst.name}  sha256:{manifest["trees"][slot]["sha256"][:12]}…')

    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'done: manifest written to {manifest_path.name}; '
              'restart the game to load the GLB forest')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
