#!/usr/bin/env python3
"""Install a photographic vegetation atlas for distant forest impostors.

Usage:
    python3 install_impostors.py ~/Downloads/forest_trees_atlas.png \
        --license CC0

The atlas must be a non-interlaced 8-bit RGBA PNG containing FOUR
horizontally arranged tree sprites (width divisible by 4). Each sprite
should be mostly transparent with an opaque tree silhouette. The file
is validated, copied to assets/textures/impostor_atlas.png, and recorded
in assets/textures/impostor_manifest.json with SHA-256 + license
metadata. No external dependencies — PNG decode is done in stdlib.
"""
import argparse
import hashlib
import json
import struct
import sys
import time
import zlib
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'assets' / 'textures'
SPECIES = 4
PNG_SIG = b'\x89PNG\r\n\x1a\n'


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def decode_rgba_png(path: Path):
    """Decode a non-interlaced 8-bit RGBA PNG -> (width, height, bytes)."""
    blob = path.read_bytes()
    if not blob.startswith(PNG_SIG):
        raise ValueError('not a PNG file')
    pos = len(PNG_SIG)
    ihdr = idat = None
    while pos + 8 <= len(blob):
        length, kind = struct.unpack('>I4s', blob[pos:pos + 8])
        payload = blob[pos + 8:pos + 8 + length]
        if len(payload) != length:
            raise ValueError('truncated PNG chunk')
        if kind == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', payload)
        elif kind == b'IDAT':
            idat = (idat or b'') + payload
        elif kind == b'IEND':
            break
        pos += 12 + length
    if not ihdr or idat is None:
        raise ValueError('PNG missing IHDR/IDAT')
    w, h, depth, color, comp, filt, interlace = ihdr
    if depth != 8 or color != 6:
        raise ValueError(
            f'need 8-bit RGBA (color type 6), got depth={depth} '
            f'color={color} — re-export as RGBA PNG')
    if interlace:
        raise ValueError('interlaced PNG unsupported — export without '
                         'interlacing')
    stride = w * 4
    raw = zlib.decompress(idat)
    if len(raw) != (stride + 1) * h:
        raise ValueError('PNG pixel data length mismatch')
    out = bytearray(h * stride)
    prev = bytearray(stride)
    src = 0
    for y in range(h):
        f = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if f == 1:      # Sub
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif f == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:    # Average
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:    # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                c = prev[i - 4] if i >= 4 else 0
                line[i] = (line[i] + paeth(a, prev[i], c)) & 0xFF
        elif f != 0:
            raise ValueError(f'unknown PNG filter {f}')
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('atlas', type=Path,
                        help='RGBA PNG atlas with 4 horizontal sprites')
    parser.add_argument('--license', default='unspecified',
                        help='asset license tag (e.g. CC0, CC-BY)')
    ns = parser.parse_args()
    try:
        w, h, px = decode_rgba_png(ns.atlas)
    except (ValueError, OSError, zlib.error) as exc:
        print(f'install_impostors: {exc}', file=sys.stderr)
        return 1
    if w % SPECIES or w < SPECIES * 16 or h < 16:
        print(f'install_impostors: {w}x{h} cannot hold {SPECIES} '
              'horizontal sprites (width must be divisible by 4)',
              file=sys.stderr)
        return 1
    cell = w // SPECIES
    # Every cell needs meaningful coverage: not empty, not a solid card.
    for i in range(SPECIES):
        opaque = total = 0
        for y in range(h):
            row = y * w * 4
            for x in range(i * cell, (i + 1) * cell, 2):
                total += 1
                if px[row + x * 4 + 3] > 96:
                    opaque += 1
        cover = opaque / total
        if cover < 0.03:
            print(f'install_impostors: sprite {i} is {cover:.1%} opaque '
                  '— looks empty', file=sys.stderr)
            return 1
        if cover > 0.97:
            print(f'install_impostors: sprite {i} is {cover:.1%} opaque '
                  '— missing transparency?', file=sys.stderr)
            return 1

    TARGET.mkdir(parents=True, exist_ok=True)
    blob = ns.atlas.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    dest = TARGET / 'impostor_atlas.png'
    dest.write_bytes(blob)
    manifest = {
        'file': dest.name, 'species': SPECIES,
        'width': w, 'height': h, 'cellWidth': cell,
        'sha256': digest, 'license': ns.license,
        'source': ns.atlas.name,
        'imported': time.strftime('%Y-%m-%dT%H:%M:%S%z')
    }
    (TARGET / 'impostor_manifest.json').write_text(
        json.dumps(manifest, indent=2) + '\n')
    print(f'installed {dest.name}: {w}x{h}, {SPECIES} sprites, '
          f'sha256 {digest[:12]}…, license {ns.license}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
