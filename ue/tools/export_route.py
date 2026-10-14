#!/usr/bin/env python3
"""Blue Hour -> Unreal Engine world exporter.

Ports the procedural route from src/world/route.js exactly (constants are
parsed out of src/core/config.js, so the JS file stays the single source of
truth) and bakes a finite map into UE-importable assets:

  ue/staging/route_spline.csv   spline waypoints (UE cm, X fwd / Y right / Z up)
  ue/staging/scatter.csv        tree/rock/shrub instances (UE cm)
  ue/staging/terrain_tile_XX_YY.glb   heightfield tiles (glTF, meters)
  ue/staging/road.glb           road ribbon (glTF, meters, UVs for albedo)
  ue/staging/road_albedo.png    procedural asphalt + painted edge lines
  ue/staging/manifest.json      everything above + material hints

Coordinate note: JS world is X east / Y up / Z forward (meters). glTF files
are written as (x, y, -z) so -Z stays "front" per the glTF spec; UE's
importer converts that to X-forward Z-up. CSV/scatter are already in UE
centimeters: ue_x = js_z*100, ue_y = js_x*100, ue_z = js_y*100.

Usage: python3 ue/tools/export_route.py [--length 6000] [--out ue/staging]
"""

import argparse
import json
import math
import os
import re
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_JS = os.path.join(ROOT, 'src', 'core', 'config.js')

ROAD_HALF = 7.0          # CFG.roadHalfWidth
BANK_SCALE = 11.0        # ROUTE.bankScale
BANK_CLAMP = 0.085       # ROUTE.bankClamp
PATH_STEP = 8.0          # CFG.pathStep
EXPORT_STEP = 4.0        # export resample density (smooths hairpins)
TERRAIN_HALF = 400.0     # corridor half-width baked into tiles
TILE = 256.0             # tile edge, meters
GRID = 2.0               # terrain vertex spacing, meters
CORRIDOR_CELL = 64.0     # spatial-hash cell for nearest-path lookup
SEED = 7


# ---------------------------------------------------------------- config ---

def _rows(text, name):
    # nested [[a,b,c], ...] block: run to the closing ']' on its own line
    m = re.search(name + r'\s*[:=]\s*\[(.*?)\n\s*\]', text, re.S)
    if not m:
        raise SystemExit('could not parse %s from %s' % (name, CONFIG_JS))
    return [[float(t) for t in r.split(',')]
            for r in re.findall(r'\[\s*([-\d.,\s]+)\]', m.group(1))]

def load_route():
    text = open(CONFIG_JS).read()
    heading = _rows(text, 'heading')
    elevation = _rows(text, 'elevation')
    bias = float(re.search(r'headingBias\s*:\s*([-\d.]+)', text).group(1))
    return heading, elevation, bias


def heading_at(s, H, bias):
    return bias + sum(a * math.sin(f * s + p) for a, f, p in H)

def curvature_at(s, H):
    return sum(a * f * math.cos(f * s + p) for a, f, p in H)

def elevation_at(s, E):
    return sum(a * math.sin(f * s + p) for a, f, p in E)

def bank_at(s, H):
    k = curvature_at(s, H)
    return -max(-BANK_CLAMP, min(BANK_CLAMP, k * BANK_SCALE))

def ground_offset(s, lateral, bank):
    """Port of route.js groundOffset()."""
    outer = max(0.0, abs(lateral) - 8.0)
    hill = (math.sin(s * 0.009 + lateral * 0.043) * 0.19
            + math.sin(s * 0.0028 - lateral * 0.077) * 0.28)
    swell = (math.sin(s * 0.0019 + abs(lateral) * 0.021 + 2.1)
             * math.sin(s * 0.00073 - lateral * 0.011 + 0.6)
             * min(outer, 64.0) * 0.11)
    lumps = math.sin(s * 0.11 + lateral * 0.31) * min(outer, 12.0) * 0.028
    return (lateral * bank - 0.11
            + outer * 0.047 + outer * hill * 0.13
            + math.sin(s * 0.045 + lateral * 0.20) * min(outer, 20.0) * 0.035
            + swell + lumps)


# ------------------------------------------------------------------ path ---

def build_path(H, bias, smax):
    """Integrate heading at PATH_STEP then resample every EXPORT_STEP."""
    pts = [(0.0, 0.0)]
    x = z = 0.0
    n = int(smax / PATH_STEP)
    for i in range(n):
        h = heading_at((i + 0.5) * PATH_STEP, H, bias)
        x += math.sin(h) * PATH_STEP
        z += math.cos(h) * PATH_STEP
        pts.append((x, z))
    # resample to EXPORT_STEP for spline/export density
    out = []
    acc = 0.0
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        seg = PATH_STEP
        t = (acc % EXPORT_STEP) or 0.0
        while t < seg:
            out.append((x0 + (x1 - x0) * t / seg, z0 + (z1 - z0) * t / seg))
            t += EXPORT_STEP
        acc += seg
    out.append(pts[-1])
    return out


def spatial_index(pts):
    grid = {}
    for i, (x, z) in enumerate(pts):
        key = (int(x // CORRIDOR_CELL), int(z // CORRIDOR_CELL))
        grid.setdefault(key, []).append(i)
    return grid


def nearest_corridor(x, z, pts, grid, sstep=EXPORT_STEP):
    """Nearest path point -> (s, lateral). Folds resolve to nearest column."""
    cx, cz = int(x // CORRIDOR_CELL), int(z // CORRIDOR_CELL)
    best = None
    for ring in range(0, 10):
        cand = []
        for dx in range(-ring, ring + 1):
            for dz in range(-ring, ring + 1):
                if max(abs(dx), abs(dz)) != ring:
                    continue
                cand += grid.get((cx + dx, cz + dz), [])
        for i in cand:
            px, pz = pts[i]
            d2 = (px - x) ** 2 + (pz - z) ** 2
            if best is None or d2 < best[0]:
                best = (d2, i)
        if best and best[0] <= (ring * CORRIDOR_CELL) ** 2:
            break
    if best is None:
        return None
    _, i = best
    # refine lateral sign + exact s projection on the local segment
    i0 = max(0, i - 1)
    i1 = min(len(pts) - 1, i + 1)
    bproj, blat, bs = None, 0.0, i * sstep
    for j in range(i0, i1):
        x0, z0 = pts[j]
        x1, z1 = pts[j + 1]
        dx, dz = x1 - x0, z1 - z0
        L2 = dx * dx + dz * dz
        if L2 == 0:
            continue
        t = max(0.0, min(1.0, ((x - x0) * dx + (z - z0) * dz) / L2))
        qx, qz = x0 + dx * t, z0 + dz * t
        d2 = (qx - x) ** 2 + (qz - z) ** 2
        if bproj is None or d2 < bproj:
            lat = ((x - qx) * dz - (z - qz) * dx) / math.sqrt(L2)  # signed
            bproj, blat, bs = d2, lat, (j + t) * sstep
    return bs, blat


def terrain_height(x, z, pts, grid, E, H):
    hit = nearest_corridor(x, z, pts, grid)
    if hit is None or abs(hit[1]) > TERRAIN_HALF:
        return None, None, None
    s, lat = hit
    y = elevation_at(s, E) + ground_offset(s, lat, bank_at(s, H))
    return y, s, lat


# --------------------------------------------------------------- glb I/O ---

def _pad4(b, pad=b' '):
    return b + pad * ((4 - len(b) % 4) % 4)

def write_glb(path, name, positions, normals, uvs, colors, indices,
              base_color=(0.5, 0.5, 0.5, 1.0), rough=0.95):
    """Minimal glTF 2.0 binary writer (meters, -Z front)."""
    views, accessors, blob = [], [], b''

    def add(data, target, comp_type, count, ctype):
        nonlocal blob
        off = len(blob)
        blob += data
        blob += b'\x00' * ((4 - len(blob) % 4) % 4)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data),
                      'target': target})
        accessors.append({'bufferView': len(views) - 1, 'componentType': ctype,
                          'count': count, 'type': comp_type})
        return len(accessors) - 1

    js = {'asset': {'version': '2.0', 'generator': 'bluehour-export'},
          'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'mesh': 0, 'name': name}],
          'materials': [{'name': name + '_mat',
                         'pbrMetallicRoughness': {
                             'baseColorFactor': list(base_color),
                             'metallicFactor': 0.0,
                             'roughnessFactor': rough}}],
          'meshes': [{'name': name, 'primitives': []}],
          'bufferViews': views, 'accessors': accessors, 'buffers': []}

    prim = {'material': 0, 'attributes': {}}
    prim['attributes']['POSITION'] = add(
        b''.join(struct.pack('<3f', *p) for p in positions),
        34962, 'VEC3', len(positions), 5126)
    prim['attributes']['NORMAL'] = add(
        b''.join(struct.pack('<3f', *n) for n in normals),
        34962, 'VEC3', len(normals), 5126)
    if uvs:
        prim['attributes']['TEXCOORD_0'] = add(
            b''.join(struct.pack('<2f', *u) for u in uvs),
            34962, 'VEC2', len(uvs), 5126)
    if colors:
        prim['attributes']['COLOR_0'] = add(
            b''.join(struct.pack('<4f', *c) for c in colors),
            34962, 'VEC4', len(colors), 5126)
    prim['indices'] = add(
        b''.join(struct.pack('<I', i) for i in indices),
        34963, 'SCALAR', len(indices), 5125)
    js['meshes'][0]['primitives'].append(prim)

    js['buffers'] = [{'byteLength': len(blob)}]
    jchunk = _pad4(json.dumps(js, separators=(',', ':')).encode())
    total = 12 + 8 + len(jchunk) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jchunk), 0x4E4F534A))
        f.write(jchunk)
        f.write(struct.pack('<II', len(blob), 0x004E4942))
        f.write(blob)


def grid_normals(w, h, height_fn):
    """Central-difference normals for a grid heightfield; height_fn(i,j)->y."""
    nrm = []
    for j in range(h):
        for i in range(w):
            l = height_fn(max(i - 1, 0), j)
            r = height_fn(min(i + 1, w - 1), j)
            d = height_fn(i, max(j - 1, 0))
            u = height_fn(i, min(j + 1, h - 1))
            nx, ny, nz = (l - r) / (2 * GRID), 1.0, (d - u) / (2 * GRID)
            L = math.sqrt(nx * nx + ny * ny + nz * nz)
            nrm.append((nx / L, ny / L, nz / L))
    return nrm


def export_terrain(pts, grid, E, H, outdir):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    x0, x1 = min(xs) - TERRAIN_HALF, max(xs) + TERRAIN_HALF
    z0, z1 = min(zs) - TERRAIN_HALF, max(zs) + TERRAIN_HALF
    nx, nz = int((x1 - x0) // TILE) + 1, int((z1 - z0) // TILE) + 1
    tiles, verts = 0, 0
    n = int(TILE / GRID) + 1
    for tx in range(nx):
        for tz in range(nz):
            ox, oz = x0 + tx * TILE, z0 + tz * TILE
            # skip tiles fully outside the corridor band
            cx, cz = ox + TILE / 2, oz + TILE / 2
            hit = nearest_corridor(cx, cz, pts, grid)
            if hit is None or abs(hit[1]) > TERRAIN_HALF + TILE:
                continue
            hs = []
            lats = []
            pos = []
            for j in range(n):
                for i in range(n):
                    wx, wz = ox + i * GRID, oz + j * GRID
                    y, s, lat = terrain_height(wx, wz, pts, grid, E, H)
                    if y is None:
                        y = 0.0   # off-corridor edge verts sit as flat skirt
                        lat = TERRAIN_HALF
                    hs.append(y)
                    lats.append(lat)
                    pos.append((wx, y, -wz))   # glTF: -Z front
            nrm = grid_normals(n, n, lambda a, b: hs[b * n + a])
            col = [(min(abs(lats[j * n + i]), 200.0) / 200.0, 0.0, 0.0, 1.0)
                   for j in range(n) for i in range(n)]
            idx = []
            for j in range(n - 1):
                for i in range(n - 1):
                    a = j * n + i
                    idx += [a, a + n, a + 1, a + 1, a + n, a + n + 1]
            path = os.path.join(outdir,
                                'terrain_tile_%02d_%02d.glb' % (tx, tz))
            write_glb(path, 'terrain_%02d_%02d' % (tx, tz),
                      pos, nrm, None, col, idx,
                      base_color=(0.36, 0.33, 0.28, 1.0))
            tiles += 1
            verts += len(pos)
            print('  tile %d/%d -> %s (%d v)' %
                  (tiles, nx * nz, os.path.basename(path), len(pos)),
                  flush=True)
    return tiles, verts, (x0, x1, z0, z1)


def export_road(pts, E, H, outdir):
    """Road ribbon, JS meters -> glTF. UV.u = across, UV.v = s/8."""
    step = EXPORT_STEP
    n = len(pts)
    pos, uv, idx = [], [], []
    half = ROAD_HALF + 0.35
    for i in range(n):
        s = i * step
        x, z = pts[i]
        h = heading_at(s, H, HEADING_BIAS)
        bank = bank_at(s, H)
        rx, rz = math.cos(h), -math.sin(h)   # right vector (JS: perp of fwd)
        elev = elevation_at(s, E)
        for lat in (-half, half):
            y = elev + lat * bank + 0.05     # float 5 cm above terrain
            pos.append((x + rx * lat, y, -(z + rz * lat)))
            uv.append((lat / (2 * half) + 0.5, s / 8.0))
    for i in range(n - 1):
        a = i * 2
        idx += [a, a + 2, a + 1, a + 1, a + 2, a + 3]
    nrm = [(0.0, 1.0, 0.0)] * len(pos)
    write_glb(os.path.join(outdir, 'road.glb'), 'road',
              pos, nrm, uv, None, idx,
              base_color=(0.16, 0.17, 0.18, 1.0), rough=0.35)
    return n * 2


def export_scatter(pts, grid, E, H, outdir):
    """Corridor scatter: trees / rocks / shrubs, UE cm."""
    import random
    rng = random.Random(SEED)
    rows = []
    s = 40.0
    smax = (len(pts) - 2) * EXPORT_STEP
    while s < smax:
        k = abs(curvature_at(s, H))
        lim = min(90.0, 0.82 / k) if k > 1e-5 else 90.0
        pidx = int(s / EXPORT_STEP)
        px, pz = pts[pidx]
        h = heading_at(s, H, HEADING_BIAS)
        rx, rz = math.cos(h), -math.sin(h)
        # trees: band +-11..min(lim-3,75)
        if rng.random() < 0.75:
            side = rng.choice((-1, 1))
            lat = side * rng.uniform(11, max(12, min(lim - 3, 75)))
            wx, wz = px + rx * lat, pz + rz * lat
            y, _, _ = terrain_height(wx, wz, pts, grid, E, H)
            if y is not None:
                rows.append(('tree', wz * 100, wx * 100, y * 100,
                             rng.uniform(0, 360), rng.uniform(0.8, 1.5)))
        if rng.random() < 0.10:
            side = rng.choice((-1, 1))
            lat = side * rng.uniform(9.5, max(10, min(lim - 4, 55)))
            wx, wz = px + rx * lat, pz + rz * lat
            y, _, _ = terrain_height(wx, wz, pts, grid, E, H)
            if y is not None:
                rows.append(('rock', wz * 100, wx * 100, y * 100,
                             rng.uniform(0, 360), rng.uniform(0.5, 2.2)))
        for _ in range(3):
            if rng.random() < 0.8:
                side = rng.choice((-1, 1))
                lat = side * rng.uniform(8.8, max(9, min(lim - 2, 26)))
                wx, wz = px + rx * lat, pz + rz * lat
                y, _, _ = terrain_height(wx, wz, pts, grid, E, H)
                if y is not None:
                    rows.append(('shrub', wz * 100, wx * 100, y * 100,
                                 rng.uniform(0, 360), rng.uniform(0.6, 1.4)))
        s += rng.uniform(4.0, 7.0)
    out = os.path.join(outdir, 'scatter.csv')
    with open(out, 'w') as f:
        f.write('type,ue_x,ue_y,ue_z,yaw_deg,scale\n')
        for r in rows:
            f.write('%s,%.1f,%.1f,%.1f,%.2f,%.3f\n' % r)
    return len(rows)


def export_spline(pts, E, H, outdir):
    out = os.path.join(outdir, 'route_spline.csv')
    with open(out, 'w') as f:
        f.write('s,ue_x,ue_y,ue_z,heading_deg,curvature,bank_deg\n')
        for i, (x, z) in enumerate(pts):
            s = i * EXPORT_STEP
            f.write('%.1f,%.1f,%.1f,%.1f,%.3f,%.6f,%.3f\n' %
                    (s, z * 100, x * 100, elevation_at(s, E) * 100,
                     math.degrees(heading_at(s, H, HEADING_BIAS)),
                     curvature_at(s, H),
                     math.degrees(bank_at(s, H))))
    return len(pts)


def road_albedo(path):
    """512x512 asphalt with painted edge lines; u across, v repeats /8m."""
    import random
    rng = random.Random(SEED)
    n = 512
    grain = [[rng.random() for _ in range(n)] for _ in range(4)]
    px = bytearray()
    for y in range(n):
        px.append(0)
        for x in range(n):
            u = x / n
            v = y / n
            g = (0.5 + 0.5 * math.sin(x * 0.31 + y * 0.17)) * 18
            g += grain[int(v * 3.9) % 4][x] * 22
            g += 8 * math.sin(v * 40 + math.sin(u * 9) * 2)
            base = 46 + g * 0.55
            # wheel wear: lighter bands near wheel paths
            wear = math.exp(-((u - 0.28) ** 2) / 0.006) + \
                   math.exp(-((u - 0.72) ** 2) / 0.006)
            base += wear * 9
            r = g_ = b = int(max(0, min(255, base)))
            if u < 0.045 or u > 0.955:   # painted edge lines, slightly worn
                fade = 0.75 + 0.25 * math.sin(y * 0.4)
                r = g_ = b = int(base + (205 - base) * fade)
            px += bytes((r, g_, b))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + \
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(bytes(px), 6)) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


# ------------------------------------------------------------------ main ---

def main():
    global HEADING_BIAS
    ap = argparse.ArgumentParser()
    ap.add_argument('--length', type=float, default=6000.0,
                    help='route metres to bake (default 6000)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'ue', 'staging'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    H, E, HEADING_BIAS = load_route()
    print('route: %d heading terms, %d elevation terms' % (len(H), len(E)))
    pts = build_path(H, HEADING_BIAS, a.length)
    print('path: %d samples over %.0f m' % (len(pts), a.length))
    grid = spatial_index(pts)

    print('spline ->', export_spline(pts, E, H, a.out), 'pts')
    print('road   ->', export_road(pts, E, H, a.out), 'verts')
    print('scatter->', export_scatter(pts, grid, E, H, a.out), 'items')
    road_albedo(os.path.join(a.out, 'road_albedo.png'))
    print('terrain tiles:')
    t, v, bb = export_terrain(pts, grid, E, H, a.out)
    print('terrain: %d tiles, %d verts' % (t, v))

    json.dump({
        'units': {'glb': 'meters (gltf, -Z front)', 'csv': 'UE centimeters'},
        'route_length_m': a.length, 'bbox_js_m': bb,
        'files': {
            'spline': 'route_spline.csv', 'road': 'road.glb',
            'scatter': 'scatter.csv', 'albedo': 'road_albedo.png',
            'terrain': 'terrain_tile_*.glb'},
        'materials': {
            'road': {'albedo': 'road_albedo.png', 'roughness': 0.32,
                     'note': 'wet asphalt; roughness 0.3-0.4 + high spec'},
            'terrain': {'blend': 'vertex color R = |lateral|/200: '
                                  'gravel near corridor -> forest floor'},
        }}, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=2)
    print('manifest.json written')


if __name__ == '__main__':
    main()
