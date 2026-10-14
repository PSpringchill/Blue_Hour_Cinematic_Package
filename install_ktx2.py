#!/usr/bin/env python3
"""Install pre-encoded KTX2 (Basis Universal) textures for the game.

Usage:
    python3 install_ktx2.py \
        --road road_color.ktx2 road_normal.ktx2 road_roughness.ktx2 \
        --terrain ground_albedo.ktx2 ground_normal.ktx2 ground_ao.ktx2 \
        --license CC0

Each slot takes up to three KTX2 files in map order (diffuse, normal,
roughness — or albedo, normal, AO for --terrain) and installs them under
the canonical names the loader probes, e.g.
assets/textures/asphalt_02_diff_2k.ktx2. The game automatically prefers
KTX2 over raster files when present.

The files must already be Basis/ETC1S/UASTC encoded; this script only
validates KTX2 headers and copies them — it does not compress textures.
Every installed file is SHA-256 hashed and recorded in
assets/textures/ktx2_manifest.json.
"""
import argparse
import hashlib
import json
import shutil
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KTX2_MAGIC = b'\xabKTX 20\xbb\r\n\x1a\n'

# slot -> (directory, [canonical basenames in positional order])
SLOTS = {
    'road': ('assets/textures', [
        'asphalt_02_diff_2k', 'asphalt_02_nor_gl_2k',
        'asphalt_02_rough_2k']),
    'ground': ('assets/textures', [
        'forrest_ground_01_diff_2k', 'forrest_ground_01_nor_gl_2k',
        'forrest_ground_01_rough_2k']),
    'verge': ('assets/textures', [
        'brown_mud_leaves_01_diff_2k', 'brown_mud_leaves_01_nor_gl_2k',
        'brown_mud_leaves_01_rough_2k']),
    'rock': ('assets/textures', [
        'rock_face_03_diff_2k', 'rock_face_03_nor_gl_2k',
        'rock_face_03_rough_2k']),
    'terrain': ('assets/terrain', [
        'ground_albedo', 'ground_normal', 'ground_ao']),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def read_ktx2_header(path: Path) -> dict:
    """Validate the 68-byte KTX2 header and return basic fields."""
    data = path.read_bytes()
    if len(data) < 68 or data[:12] != KTX2_MAGIC:
        raise ValueError('not a KTX2 file (bad magic header)')
    fields = struct.unpack_from('<9I', data, 12)
    (vk_format, type_size, width, height, depth,
     layers, faces, levels, supercompression) = fields
    if width == 0 or height == 0:
        raise ValueError('KTX2 has zero pixel dimensions')
    if levels == 0:
        raise ValueError('KTX2 declares zero mip levels')
    if faces not in (1, 6):
        raise ValueError(f'KTX2 face count {faces} is invalid')
    return {
        'width': width, 'height': height, 'levels': levels,
        'supercompression':
            {0: 'none', 1: 'basis-lz', 2: 'zstd', 3: 'zlib'}
            .get(supercompression, str(supercompression))
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for slot in SLOTS:
        order = ('albedo, normal, AO' if slot == 'terrain'
                 else 'diffuse, normal (OpenGL), roughness')
        parser.add_argument(
            f'--{slot}', nargs='+', type=Path, metavar='FILE.ktx2',
            help=f'{slot} maps in order: {order}')
    parser.add_argument('--license', default='unspecified',
                        help='asset license tag recorded in the manifest')
    ns = parser.parse_args()

    requested = {slot: files for slot in SLOTS
                 if (files := getattr(ns, slot))}
    if not requested:
        parser.error('provide at least one of ' +
                     ', '.join(f'--{s}' for s in SLOTS))

    manifest_path = ROOT / 'assets' / 'textures' / 'ktx2_manifest.json'
    manifest = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text())
        except ValueError:
            manifest = {}
    manifest.setdefault('ktx2', {})

    installed = 0
    for slot, files in requested.items():
        directory, names = SLOTS[slot]
        if len(files) > len(names):
            print(f'skip --{slot}: {len(files)} files, '
                  f'max {len(names)} ({", ".join(names)})')
            continue
        target_dir = ROOT / directory
        target_dir.mkdir(parents=True, exist_ok=True)
        for src, base in zip(files, names):
            src = src.expanduser()
            if not src.is_file():
                print(f'skip {src}: not a file')
                continue
            try:
                info = read_ktx2_header(src)
            except ValueError as exc:
                print(f'skip {src.name}: {exc}')
                continue
            dst = target_dir / f'{base}.ktx2'
            shutil.copyfile(src, dst)
            manifest['ktx2'][base] = {
                'file': str(dst.relative_to(ROOT)),
                'source': src.name,
                'slot': slot,
                'license': ns.license,
                'size': f'{info["width"]}x{info["height"]}',
                'levels': info['levels'],
                'supercompression': info['supercompression'],
                'sha256': sha256(dst),
                'installed': time.strftime('%Y-%m-%dT%H:%M:%S%z')
            }
            installed += 1
            print(f'{src.name} -> {dst.relative_to(ROOT)}  '
                  f'{info["width"]}x{info["height"]} '
                  f'({info["supercompression"]})  '
                  f'sha256:{manifest["ktx2"][base]["sha256"][:12]}…')

    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    if not installed:
        print('nothing installed')
        return 1
    print('done: manifest written; the game prefers .ktx2 textures '
          'over raster files automatically')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
