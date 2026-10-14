#!/usr/bin/env python3
"""Import real elevation data into Blue Hour world regions.

Reads a projected ESRI ASCII grid (.asc) DEM plus a route-control CSV
and writes regions/region_XXXX.json descriptors with a 17x17 elevation
grid per 256 m x 640 m tile — metres relative to the corridor elevation
at each row. The in-game streamer renders these directly, so distant
terrain follows the real landscape while the road stays procedural.

Usage:
    python3 import_dem.py \
        --dem ~/Data/mountain_dem.asc \
        --route ~/Data/route_control.csv \
        --start 0 --count 12 --crs EPSG:32647 --overwrite

Route CSV needs a header row with a distance column (`s`, `dist` or
`distance`, metres along the route) and position columns (`easting`/`x`/`e`
and `northing`/`y`/`n`) in the same projected CRS as the DEM. The DEM
must already be in a metre-based projected CRS — no reprojection is
performed; --crs is recorded as provenance metadata only.

Lateral convention: column 0 is 320 m to the RIGHT of travel direction,
column 16 is 320 m to the LEFT (matching the game's lateral axis).
"""
import argparse
import csv
import hashlib
import json
import math
import sys
import time
from bisect import bisect_left
from pathlib import Path

GRID = 17
SPAN = 256        # metres along the route per region
HALF = 320        # metres across, |x| <= 320
ELEV_MIN, ELEV_MAX = -500.0, 9000.0


def parse_dem(path: Path):
    """Parse an ESRI ASCII grid into (header, rows of floats)."""
    header = {}
    data_start = 0
    with open(path) as fh:
        for _ in range(6):
            parts = fh.readline().split()
            if len(parts) < 2:
                raise ValueError('truncated DEM header')
            header[parts[0].lower()] = float(parts[1])
            data_start += 1
        for key in ('ncols', 'nrows', 'cellsize'):
            if key not in header:
                raise ValueError(f'missing DEM header field {key}')
        if 'xllcorner' not in header and 'xllcenter' not in header:
            raise ValueError('DEM header needs xllcorner or xllcenter')
        if 'yllcorner' not in header and 'yllcenter' not in header:
            raise ValueError('DEM header needs yllcorner or yllcenter')
        ncols, nrows = int(header['ncols']), int(header['nrows'])
        if not (2 <= ncols <= 20000 and 2 <= nrows <= 20000):
            raise ValueError(f'implausible raster size {ncols}x{nrows}')
        if header['cellsize'] <= 0:
            raise ValueError('cellsize must be positive')
        rows = []
        for _ in range(nrows):
            line = fh.readline()
            if not line:
                raise ValueError('DEM raster shorter than nrows')
            row = [float(v) for v in line.split()]
            if len(row) != ncols:
                raise ValueError(
                    f'DEM row has {len(row)} values, expected {ncols}')
            rows.append(row)
    half = header['cellsize'] / 2
    x0 = header['xllcorner'] if 'xllcorner' in header \
        else header['xllcenter'] - half
    y0 = header['yllcorner'] if 'yllcorner' in header \
        else header['yllcenter'] - half
    nodata = header.get('nodata_value', -9999.0)
    return {
        'ncols': ncols, 'nrows': nrows, 'cell': header['cellsize'],
        'x0': x0, 'y0': y0, 'nodata': nodata, 'rows': rows
    }


def dem_sample(dem, e, n):
    """Bilinear elevation at (easting, northing); None outside/nodata."""
    fx = (e - dem['x0']) / dem['cell'] - 0.5
    fy = (dem['nrows'] - 1) - (n - dem['y0']) / dem['cell'] + 0.5
    # Half-cell tolerance: points on the raster edge clamp to the
    # nearest cell rather than reporting no coverage.
    if (fx < -0.5 or fy < -0.5 or
            fx > dem['ncols'] - 0.5 or fy > dem['nrows'] - 0.5):
        return None
    fx = min(max(fx, 0.0), dem['ncols'] - 1)
    fy = min(max(fy, 0.0), dem['nrows'] - 1)
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(x0 + 1, dem['ncols'] - 1), min(y0 + 1, dem['nrows'] - 1)
    tx, ty = fx - x0, fy - y0
    vals = [
        (dem['rows'][y0][x0], (1 - tx) * (1 - ty)),
        (dem['rows'][y0][x1], tx * (1 - ty)),
        (dem['rows'][y1][x0], (1 - tx) * ty),
        (dem['rows'][y1][x1], tx * ty)
    ]
    total = sum(w for v, w in vals if v != dem['nodata'])
    if total <= 0:
        return None
    return sum(v * w for v, w in vals if v != dem['nodata']) / total


def parse_route(path: Path):
    """Route control CSV -> sorted (s, easting, northing) tuples."""
    with open(path, newline='') as fh:
        rows = list(csv.reader(fh))
    if not rows:
        raise ValueError('empty route CSV')
    header = [h.strip().lower() for h in rows[0]]
    def col(*names):
        for name in names:
            if name in header:
                return header.index(name)
        raise ValueError(f'route CSV needs one of {names}')
    ci, ce, cn = col('s', 'dist', 'distance'), \
        col('easting', 'x', 'e'), col('northing', 'y', 'n')
    pts = []
    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        pts.append((float(row[ci]), float(row[ce]), float(row[cn])))
    pts.sort()
    if len(pts) < 2:
        raise ValueError('route CSV needs at least 2 control points')
    return pts


def route_pose(pts, s):
    """Interpolate (easting, northing, heading) at route distance s."""
    ss = [p[0] for p in pts]
    i = min(len(pts) - 2, max(0, bisect_left(ss, s) - 1))
    s0, e0, n0 = pts[i]
    s1, e1, n1 = pts[i + 1]
    t = 0.0 if s1 == s0 else min(1.0, max(0.0, (s - s0) / (s1 - s0)))
    e = e0 + (e1 - e0) * t
    n = n0 + (n1 - n0) * t
    heading = math.atan2(n1 - n0, e1 - e0)
    return e, n, heading


def update_index(target: Path):
    files = sorted(int(p.stem.split('_')[1])
                   for p in target.glob('region_[0-9][0-9][0-9][0-9].json'))
    start = files[0] if files else 0
    count = 0
    while start + count in set(files):
        count += 1
    (target / 'index.json').write_text(json.dumps({
        'start': start, 'count': count, 'grid': GRID,
        'span': SPAN, 'halfWidth': HALF
    }, indent=2) + '\n')
    return start, count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dem', required=True, type=Path,
                        help='projected ESRI ASCII grid (.asc)')
    parser.add_argument('--route', required=True, type=Path,
                        help='route control CSV (s,easting,northing)')
    parser.add_argument('--start', type=int, default=0,
                        help='first region index to write')
    parser.add_argument('--count', type=int, default=16,
                        help='number of regions to import')
    parser.add_argument('--crs', default='unknown',
                        help='projected CRS of the DEM, e.g. EPSG:32647 '
                             '(metadata only — no reprojection)')
    parser.add_argument('--overwrite', action='store_true',
                        help='replace existing region files')
    parser.add_argument('--out', type=Path,
                        default=Path(__file__).resolve().parent / 'regions',
                        help='output directory (default: regions/)')
    ns = parser.parse_args()
    if ns.start < 0 or ns.count < 1:
        parser.error('--start must be >= 0 and --count >= 1')

    try:
        dem = parse_dem(ns.dem)
        route = parse_route(ns.route)
    except (ValueError, OSError) as exc:
        print(f'import_dem: {exc}', file=sys.stderr)
        return 1

    s_lo = ns.start * SPAN
    s_hi = (ns.start + ns.count) * SPAN
    if s_hi > route[-1][0]:
        print(f'import_dem: route ends at {route[-1][0]:.0f} m but '
              f'{s_hi} m is needed for --start/--count',
              file=sys.stderr)
        return 1

    digest = hashlib.sha256(ns.dem.read_bytes()).hexdigest()
    ns.out.mkdir(parents=True, exist_ok=True)
    written = skipped = 0
    for i in range(ns.start, ns.start + ns.count):
        out = ns.out / f'region_{i:04d}.json'
        if out.exists() and not ns.overwrite:
            print(f'{out.name}: exists (use --overwrite)')
            skipped += 1
            continue
        s0 = i * SPAN
        elevations = []
        missing = 0
        e_min = e_max = None
        for r in range(GRID):
            s = s0 + r / (GRID - 1) * SPAN
            e, n, heading = route_pose(route, s)
            # Lateral axis: +x is LEFT of travel — column 0 is x=-320.
            lx, ly = -math.sin(heading), math.cos(heading)
            road_z = dem_sample(dem, e, n)
            if road_z is None:
                print(f'import_dem: route leaves DEM coverage at '
                      f's={s:.0f} m', file=sys.stderr)
                return 1
            for c in range(GRID):
                x = (c / (GRID - 1) * 2 - 1) * HALF
                z = dem_sample(dem, e + lx * x, n + ly * x)
                if z is None:
                    z = road_z
                    missing += 1
                rel = z - road_z
                if not (ELEV_MIN <= z <= ELEV_MAX):
                    print(f'import_dem: elevation {z} outside '
                          f'[{ELEV_MIN}, {ELEV_MAX}] at s={s:.0f}',
                          file=sys.stderr)
                    return 1
                e_min = rel if e_min is None else min(e_min, rel)
                e_max = rel if e_max is None else max(e_max, rel)
                elevations.append(round(rel, 2))
        if missing > GRID * GRID // 4:
            print(f'import_dem: {missing}/289 samples off-DEM in '
                  f'region {i} — check DEM coverage', file=sys.stderr)
            return 1
        # Forest proxy: steeper/rougher relief reads as less forested.
        relief = (e_max or 0) - (e_min or 0)
        forest = round(min(0.85, max(0.15, 0.75 - relief / 900)), 3)
        desc = {
            'index': i,
            'seed': i * 7919 + 137,
            'biome': 'imported-dem',
            'forest': forest,
            'span': SPAN,
            'halfWidth': HALF,
            'grid': GRID,
            'elevations': elevations,
            'elevationRange': [round(e_min, 2), round(e_max, 2)],
            'source': {
                'dem': ns.dem.name, 'route': ns.route.name,
                'crs': ns.crs, 'cellsize': dem['cell'],
                'sha256': digest
            },
            'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z')
        }
        out.write_text(json.dumps(desc) + '\n')
        written += 1
        print(f'{out.name}: relief {rel:.0f} m, forest {forest}'
              + (f', {missing} samples snapped to road' if missing else ''))

    start, count = update_index(ns.out)
    print(f'done: {written} imported, {skipped} skipped; index.json '
          f'covers {count} contiguous file(s) from {start}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
