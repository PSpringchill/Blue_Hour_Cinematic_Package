#!/usr/bin/env bash
# Convert Blue Hour web assets into UE-importable formats.
#   .webp -> .png      via macOS sips (UE has no WebP importer)
#   .glb  -> .fbx      via Blender headless (bulletproof vs KHR quantization)
#   .jpg/.png -> copy  (UE imports them directly)
#
# Usage: bash ue/tools/convert_assets.sh [staging_dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="${1:-$ROOT/ue/staging}"
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"
mkdir -p "$STAGE/models" "$STAGE/textures" "$STAGE/nature"

echo "== textures: webp -> png =="
find "$ROOT/assets" "$ROOT/cars/tex" -name '*.webp' -o -name '*.png' -o -name '*.jpg' 2>/dev/null | while read -r f; do
  base=$(basename "$f"); out="$STAGE/textures/${base%.*}.png"
  case "$f" in
    *.webp) sips -s format png "$f" --out "$out" >/dev/null ;;
    *)      cp "$f" "$STAGE/textures/$base" ;;
  esac
done
ls "$STAGE/textures" | wc -l | xargs echo "textures staged:"

echo "== models: glb -> fbx (blender headless) =="
if [ -x "$BLENDER" ]; then
  for g in "$ROOT/cars/aston_db4.glb" \
           "$ROOT/assets/nature/kit_props.glb" \
           "$ROOT"/assets/nature/*.glb \
           "$ROOT"/trees/*.glb "$ROOT"/scenery/*.glb; do
    [ -f "$g" ] || continue
    name=$(basename "${g%.glb}")
    out="$STAGE/models/$name.fbx"
    [ -f "$out" ] && { echo "  skip $name (exists)"; continue; }
    "$BLENDER" -b --factory-startup --python-expr "
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='$g')
bpy.ops.export_scene.fbx(filepath='$out',
    add_leaf_bones=False, path_mode='COPY', embed_textures=False)
" >/dev/null 2>&1 && [ -f "$out" ] && echo "  ok  $name.fbx" || echo "  FAIL $name (keep glb, Interchange will try)"
    [ -f "$out" ] || cp "$g" "$STAGE/models/$name.glb" 2>/dev/null || true
  done
else
  echo "  blender not found - copying .glb files for Interchange import"
  for g in "$ROOT/cars/aston_db4.glb" "$ROOT"/assets/nature/*.glb "$ROOT"/trees/*.glb "$ROOT"/scenery/*.glb; do
    [ -f "$g" ] && cp "$g" "$STAGE/models/"
  done
fi
ls "$STAGE/models" 2>/dev/null | wc -l | xargs echo "models staged:"
echo "done -> $STAGE"
