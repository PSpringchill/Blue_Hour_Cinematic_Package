#!/usr/bin/env python3
"""Install 1–4 locally acquired static tree GLBs with provenance metadata.

  python3 install_forest.py spruce.glb pine.glb --license CC0 \
      --source 'https://example.com/asset-page'

No models are downloaded by this tool. Verify the license of each input first.
Animated/skinned and extremely high-poly assets should be simplified in Blender.
"""
import argparse
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / 'assets' / 'models'
MAX_MB = 160


def inspect_glb(file):
    """Validate the binary GLB container and extract basic mesh complexity."""
    size = file.stat().st_size
    if not 20 <= size <= MAX_MB * 1024 * 1024:
        raise ValueError(f'Invalid or oversized GLB ({size / 1048576:.1f} MB); max {MAX_MB} MB')
    with file.open('rb') as f:
        header = f.read(12)
        if len(header) != 12: raise ValueError('Truncated GLB header')
        magic, version, length = struct.unpack('<4sII', header)
        if magic != b'glTF' or version != 2 or length != size:
            raise ValueError('Expected a valid glTF 2.0 .glb with matching declared length')
        chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
        if chunk_type != b'JSON' or chunk_len > size - 20:
            raise ValueError('GLB first chunk must be a JSON chunk')
        info = json.loads(f.read(chunk_len).rstrip(b'\x00 \t\r\n').decode('utf-8'))
    meshes = info.get('meshes', [])
    if not meshes: raise ValueError('GLB contains no meshes')
    if info.get('skins') or info.get('animations'):
        raise ValueError('Only static, unskinned trees are supported; bake animations first')
    primitives = sum(len(mesh.get('primitives', [])) for mesh in meshes)
    if primitives > 12:
        print(f'WARNING: {primitives} mesh primitives detected; scene uses at most 6 mesh nodes per tree. Combine parts in Blender.')
    accessors = info.get('accessors', [])
    triangles = 0
    for mesh in meshes:
        for primitive in mesh.get('primitives', []):
            indices = primitive.get('indices')
            count = accessors[indices].get('count', 0) if isinstance(indices, int) and indices < len(accessors) else 0
            triangles += count // 3
    if triangles > 65000:
        print(f'WARNING: about {triangles:,} indexed triangles/tree. Create an optimized LOD (prefer <20,000/tree).')
    return {'mesh_primitives': primitives, 'triangles_estimate': triangles, 'bytes': size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trees', nargs='+', help='1–4 static .glb tree assets, Y-up')
    parser.add_argument('--license', default='unspecified', help='License label you verified for these assets (e.g. CC0)')
    parser.add_argument('--source', default='', help='Asset landing page URL, for provenance/credits')
    a = parser.parse_args()
    if not 1 <= len(a.trees) <= 4:
        parser.error('Provide between 1 and 4 tree GLBs')
    TARGET.mkdir(parents=True, exist_ok=True)
    entries = []
    for i, candidate in enumerate(a.trees):
        file = Path(candidate).expanduser().resolve()
        if not file.is_file() or file.suffix.lower() != '.glb':
            raise ValueError(f'Not a GLB file: {file}')
        stats = inspect_glb(file)
        name = re.sub(r'[^A-Za-z0-9_-]', '_', file.stem)[:60]
        dest = TARGET / f'{i + 1}_{name}.glb'
        shutil.copyfile(file, dest)
        with dest.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        entries.append({
            'path': f'./assets/models/{dest.name}',
            'source': a.source,
            'license': a.license,
            'sha256': digest,
            **stats
        })
        print(f'Installed {dest.name}: {stats["mesh_primitives"]} mesh primitives, '
              f'{stats["triangles_estimate"]:,} approximate indexed triangles')
    mf = TARGET / 'manifest.json'
    mf.write_text(json.dumps({'format_version': 3, 'trees': entries}, indent=2) + '\n')
    print('Created', mf, '\nAssets will appear as near-camera instanced LOD forest trees.')
    if a.license == 'unspecified':
        print('WARNING: License not specified. Check permissions before distribution.')


if __name__ == '__main__':
    main()
