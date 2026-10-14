#!/usr/bin/env python3
"""Install Poly Haven texture ZIPs into ./assets/textures/.

Each ZIP is scanned for its PBR maps and the diffuse / OpenGL-normal /
roughness maps are extracted under the canonical 2k filenames the game
loads, e.g. assets/textures/asphalt_02_diff_2k.jpg.

Usage:
    python3 install_pbr.py ~/Downloads/asphalt_02.zip \
        ~/Downloads/forrest_ground_01.zip ~/Downloads/brown_mud_leaves_01.zip
"""
import re
import sys
import zipfile
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'assets' / 'textures'
MEMBER = re.compile(
    r'(?P<asset>[a-z0-9_]+)_(?P<map>diff|nor_gl|rough)_(?P<res>\d+k)\.'
    r'(?P<ext>jpg|jpeg|png)$'
)
RES_PREFERENCE = {'2k': 0, '1k': 1, '4k': 2, '8k': 3, '16k': 4}


def install(zip_path: Path) -> int:
    if not zip_path.is_file():
        print(f'skip {zip_path}: not a file')
        return 0
    found = {}
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.namelist():
            name = Path(info).name.lower()
            match = MEMBER.search(name)
            if not match:
                continue
            key = (match['asset'], match['map'])
            rank = (RES_PREFERENCE.get(match['res'], 9),
                    0 if match['ext'] != 'png' else 1)
            if key not in found or rank < found[key][0]:
                found[key] = (rank, info)
        count = 0
        for (asset, kind), (_, info) in found.items():
            out = TARGET / f'{asset}_{kind}_2k.jpg'
            out.write_bytes(zf.read(info))
            print(f'{zip_path.name}: {Path(info).name} -> {out.name}')
            count += 1
    if not count:
        print(f'{zip_path.name}: no usable diff/nor_gl/rough maps found')
    return count


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    TARGET.mkdir(exist_ok=True)
    total = sum(install(Path(arg).expanduser()) for arg in sys.argv[1:])
    print(f'done: {total} map(s) installed into {TARGET}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
