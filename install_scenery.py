#!/usr/bin/env python3
"""Install scanned scenery GLB props into ./scenery/ for the environment.

Usage:
    python3 install_scenery.py \
        --rock ~/Downloads/forest_rock.glb \
        --fern ~/Downloads/fern.glb \
        --stump ~/Downloads/stump.glb \
        --shrub ~/Downloads/shrub.glb \
        --license CC0

Each slot is optional; missing assets keep the procedural equivalents.
Every file is validated as binary glTF, its JSON chunk is parsed to
estimate triangle count (files over --max-tris are rejected), hashed with
SHA-256, and recorded in scenery/manifest.json with license metadata.
"""
import argparse
import hashlib
import json
import shutil
import struct
import sys
import time
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'scenery'
SLOTS = ['rock', 'fern', 'stump', 'shrub']
GLB_MAGIC = b'glTF'
JSON_CHUNK = 0x4E4F534A  # 'JSON'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def read_glb_json(path: Path) -> dict:
    """Return the glTF JSON chunk or raise ValueError."""
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != GLB_MAGIC:
        raise ValueError('not a binary glTF (.glb) file')
    length = struct.unpack_from('<I', data, 8)[0]
    if length != len(data):
        raise ValueError('GLB length field does not match file size')
    chunk_len, chunk_type = struct.unpack_from('<II', data, 12)
    if chunk_type != JSON_CHUNK:
        raise ValueError('first GLB chunk is not JSON')
    return json.loads(data[20:20 + chunk_len])


def triangle_count(gltf: dict) -> int:
    """Sum indexed primitive triangles across all meshes."""
    accessors = gltf.get('accessors', [])
    tris = 0
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            idx = prim.get('indices')
            if idx is not None and idx < len(accessors):
                tris += accessors[idx].get('count', 0) // 3
            elif 'POSITION' in prim.get('attributes', {}):
                pos = prim['attributes']['POSITION']
                if pos < len(accessors):
                    tris += accessors[pos].get('count', 0) // 3
    return tris


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for slot in SLOTS:
        parser.add_argument(f'--{slot}', type=Path,
                            help=f'.glb model installed as {slot}.glb')
    parser.add_argument('--license', default='unspecified',
                        help='asset license tag recorded in the manifest')
    parser.add_argument('--max-tris', type=int, default=80000,
                        help='reject models above this triangle count')
    ns = parser.parse_args()

    requested = {slot: getattr(ns, slot).expanduser()
                 for slot in SLOTS if getattr(ns, slot)}
    if not requested:
        parser.error('provide at least one of ' +
                     ', '.join(f'--{s}' for s in SLOTS))

    TARGET.mkdir(exist_ok=True)
    manifest_path = TARGET / 'manifest.json'
    manifest = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text())
        except ValueError:
            manifest = {}
    manifest.setdefault('scenery', {})

    installed = 0
    for slot, src in requested.items():
        if not src.is_file():
            print(f'skip {src}: not a file')
            continue
        try:
            gltf = read_glb_json(src)
        except (ValueError, struct.error) as exc:
            print(f'skip {src.name}: {exc}')
            continue
        tris = triangle_count(gltf)
        if tris > ns.max_tris:
            print(f'skip {src.name}: {tris} triangles exceeds '
                  f'--max-tris {ns.max_tris} (decimate first)')
            continue
        dst = TARGET / f'{slot}.glb'
        shutil.copyfile(src, dst)
        manifest['scenery'][slot] = {
            'file': dst.name,
            'source': src.name,
            'license': ns.license,
            'triangles': tris,
            'sha256': sha256(dst),
            'installed': time.strftime('%Y-%m-%dT%H:%M:%S%z')
        }
        installed += 1
        print(f'{src.name} -> scenery/{dst.name}  {tris} tris  '
              f'sha256:{manifest["scenery"][slot]["sha256"][:12]}…')

    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    if not installed:
        print('nothing installed')
        return 1
    print('done: manifest written to scenery/manifest.json; '
          'restart the game to load scanned scenery')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
