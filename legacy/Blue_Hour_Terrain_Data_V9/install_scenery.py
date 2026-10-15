#!/usr/bin/env python3
"""Install up to four local static glTF GLB photogrammetry props for Blue Hour v6.

Examples:
  python3 install_scenery.py --rock /path/to/rock.glb --fern /path/to/fern.glb \
      --license CC0 --source https://polyhaven.com/\n  python3 install_scenery.py --stump stump.glb --shrub shrub.glb --license CC-BY-4.0

GLBs must embed their textures and must not reference external files or URLs.
External assets are not included or fetched. Check permissions and attribution.
"""
import argparse
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / 'assets' / 'scenery'
MAX_BYTES = 85 * 1024 * 1024
MAX_TRIANGLES = 20_000
TYPE_TRIANGLE_CAP = {'rock':12_000,'fern':4_500,'stump':12_000,'shrub':4_500}
VALID_TYPES = ('rock', 'fern', 'stump', 'shrub')


def inspect_glb(path):
    """Conservative glTF 2.0 container and complexity checks, not a full parser."""
    size = path.stat().st_size
    if not 20 <= size <= MAX_BYTES:
        raise ValueError(f'File size outside 20 bytes to {MAX_BYTES // 1024**2} MiB')
    with path.open('rb') as stream:
        head = stream.read(12)
        if len(head) != 12:
            raise ValueError('Truncated GLB header')
        magic, version, declared = struct.unpack('<4sII', head)
        if (magic, version, declared) != (b'glTF', 2, size):
            raise ValueError('Invalid glTF 2.0 GLB container/length')
        raw = stream.read(8)
        if len(raw) != 8:
            raise ValueError('Truncated GLB chunk')
        length, chunk_type = struct.unpack('<I4s', raw)
        if chunk_type != b'JSON' or length > size - 20 or length % 4:
            raise ValueError('Expected a valid, padded JSON chunk')
        doc = json.loads(stream.read(length).strip(b'\x00 \r\n\t').decode('utf-8'))
    if doc.get('asset', {}).get('version') != '2.0':
        raise ValueError('Expected glTF asset version 2.0')
    if doc.get('skins') or doc.get('animations'):
        raise ValueError('Rigged or animated models are unsupported; bake before installing')
    meshes = doc.get('meshes', [])
    if not meshes:
        raise ValueError('GLB does not contain any meshes')
    # Embedded binary GLB only. GLTF may legally reference external URIs; forbid
    # those, so package works offline without unexpected third-party fetches.
    for field in ('buffers', 'images'):
        for entry in doc.get(field, []):
            uri = entry.get('uri')
            if uri is not None and not uri.startswith('data:'):
                raise ValueError(f'External {field} URI forbidden: {uri[:90]}')
    accessors = doc.get('accessors', [])
    primitives = 0
    triangles = 0
    for mesh in meshes:
        for prim in mesh.get('primitives', []):
            primitives += 1
            mode = prim.get('mode', 4)
            if mode != 4:
                raise ValueError('Only triangle GLB primitives supported')
            index = prim.get('indices')
            if index is not None:
                if not isinstance(index, int) or index < 0 or index >= len(accessors):
                    raise ValueError('Invalid index accessor')
                count = accessors[index].get('count', 0)
            else:
                pos = prim.get('attributes', {}).get('POSITION')
                if not isinstance(pos, int) or pos < 0 or pos >= len(accessors):
                    raise ValueError('Expected mesh POSITION accessor')
                count = accessors[pos].get('count', 0)
            triangles += count // 3
    if not primitives or primitives > 8:
        raise ValueError(f'GLB has {primitives} primitives; simplify to 1–8')
    if triangles > MAX_TRIANGLES:
        raise ValueError(f'GLB has {triangles:,} triangles; recommended maximum is {MAX_TRIANGLES:,}')
    return {'mesh_primitives': primitives, 'triangles_estimate': triangles, 'bytes': size}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for kind in VALID_TYPES:
        parser.add_argument('--' + kind, help=f'Local static {kind} GLB model')
    parser.add_argument('--license', default='unspecified', help='Verified asset license label')
    parser.add_argument('--source', default='', help='Asset landing page URL, for provenance')
    args = parser.parse_args(argv)
    supplied = [(kind, getattr(args, kind)) for kind in VALID_TYPES if getattr(args, kind)]
    if not supplied:
        parser.error('Provide at least one of --rock, --fern, --stump, --shrub')
    if args.source and urlparse(args.source).scheme not in ('http', 'https'):
        parser.error('--source must be a URL beginning http:// or https://')
    TARGET.mkdir(parents=True, exist_ok=True)
    mf = TARGET / 'manifest.json'
    previous = json.loads(mf.read_text()) if mf.exists() else {}
    entries = {p['type']: p for p in previous.get('props', [])
               if p.get('type') in VALID_TYPES and isinstance(p.get('path'), str)}
    for kind, supplied_file in supplied:
        source = Path(supplied_file).expanduser().resolve()
        if not source.is_file() or source.suffix.lower() != '.glb':
            raise ValueError(f'Expected local .glb file: {source}')
        stats = inspect_glb(source)
        if stats['triangles_estimate'] > TYPE_TRIANGLE_CAP[kind]:
            raise ValueError(f'{kind} has {stats["triangles_estimate"]:,} triangles; '
                             f'limit is {TYPE_TRIANGLE_CAP[kind]:,} for real-time instancing')
        clean_name = re.sub(r'[^A-Za-z0-9_-]', '_', source.stem)[:48]
        dest = TARGET / f'{kind}_{clean_name}.glb'
        if source != dest: shutil.copyfile(source, dest)
        with dest.open('rb') as inp:
            digest = hashlib.file_digest(inp, 'sha256').hexdigest()
        entries[kind] = {
            'type': kind,
            'path': './assets/scenery/' + dest.name,
            'sha256': digest,
            'license': args.license,
            'source': args.source,
            **stats
        }
        print(f'Installed {kind}: {stats["triangles_estimate"]:,} triangles, '
              f'{stats["bytes"] / 1048576:.2f} MiB; SHA-256 {digest[:14]}...')
    mf.write_text(json.dumps({'format_version': 1,
                              'props': [entries[k] for k in VALID_TYPES if k in entries]},
                             indent=2) + '\n')
    print('Updated:', mf)
    if args.license == 'unspecified':
        print('WARNING: Asset license not declared; verify redistribution permission first.')


if __name__ == '__main__':
    main()
