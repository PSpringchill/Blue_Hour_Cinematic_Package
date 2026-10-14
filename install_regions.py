#!/usr/bin/env python3
"""Generate synthetic world-region descriptors for the streaming world.

Usage:
    python3 install_regions.py --start 0 --count 16

Writes regions/region_XXXX.json files consumed by the in-game region
streamer. Each file carries the region index, a deterministic seed, a
biome tag, a forest-density factor, and a 17x17 normalized elevation
grid sampled across the 256 m x 640 m tile (rows along the route,
columns across it).

These are synthetic sample heightfields, not authentic geographic
scans — replace them with real elevation data in the same format to
drive the world from an actual terrain dataset.
"""
import argparse
import json
import math
import random
import time
from pathlib import Path

TARGET = Path(__file__).resolve().parent / 'regions'
GRID = 17
SPAN = 256        # metres along the route
HALF = 320        # metres across, |x| <= 320


def synthetic_heights(index: int) -> list:
    """Deterministic layered-sine heightfield in [0, 1]."""
    rng = random.Random(index * 7919 + 137)
    p1 = rng.uniform(0, 6.28)
    p2 = rng.uniform(0, 6.28)
    p3 = rng.uniform(0, 6.28)
    f1 = rng.uniform(0.6, 1.1)
    f2 = rng.uniform(1.3, 2.1)
    heights = []
    for r in range(GRID):
        s = r / (GRID - 1) * SPAN
        for c in range(GRID):
            x = (c / (GRID - 1) * 2 - 1) * HALF
            h = (0.55
                 + 0.28 * math.sin(s * 0.004 * f1 + x * 0.006 + p1)
                 + 0.17 * math.sin(s * 0.009 * f2 - x * 0.011 + p2)
                 + 0.10 * math.sin(x * 0.021 + s * 0.013 + p3))
            heights.append(round(min(1, max(0, h)), 4))
    return heights


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', type=int, default=0,
                        help='first region index to generate')
    parser.add_argument('--count', type=int, default=16,
                        help='number of region files to write')
    ns = parser.parse_args()
    if ns.count < 1 or ns.start < 0:
        parser.error('--start must be >= 0 and --count >= 1')

    TARGET.mkdir(exist_ok=True)
    written = 0
    for i in range(ns.start, ns.start + ns.count):
        desc = {
            'index': i,
            'seed': i * 7919 + 137,
            'biome': 'alpine',
            'forest': round(0.45 + 0.4 * max(0.0, math.sin(i * 1.71)), 3),
            'span': SPAN,
            'halfWidth': HALF,
            'grid': GRID,
            'heights': synthetic_heights(i),
            'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z')
        }
        assert len(desc['heights']) == GRID * GRID
        path = TARGET / f'region_{i:04d}.json'
        path.write_text(json.dumps(desc) + '\n')
        written += 1
        print(f'{path.name}: seed {desc["seed"]}, '
              f'forest {desc["forest"]}, {GRID}x{GRID} heights')

    # The game reads index.json to know which descriptors exist and
    # reuses them cyclically along the endless route.
    files = sorted(int(p.stem.split('_')[1])
                   for p in TARGET.glob('region_[0-9][0-9][0-9][0-9].json'))
    start = files[0] if files else 0
    count = 0
    while start + count in set(files):
        count += 1
    (TARGET / 'index.json').write_text(json.dumps({
        'start': start, 'count': count, 'grid': GRID,
        'span': SPAN, 'halfWidth': HALF
    }, indent=2) + '\n')
    print(f'done: {written} region file(s) written to {TARGET.name}/; '
          f'index.json covers {count} contiguous file(s) from {start}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
