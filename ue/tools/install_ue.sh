#!/usr/bin/env bash
# Install the BlueHour UE project next to the engine on the external drive
# (internal disk is nearly full; the project + DDC needs several GB).
#
# Usage: bash ue/tools/install_ue.sh [target_dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-/Volumes/One Touch/Unreal-Engine/BlueHour}"
DB4="$ROOT/cars/AstonDB4_Unreal_Environment"

mkdir -p "$TARGET"
# no --delete: imported .uasset content under Content/BlueHour must survive
rsync -a \
  --exclude 'Binaries' --exclude 'Intermediate' --exclude 'Saved' \
  --exclude 'DerivedDataCache' --exclude 'Build' \
  "$ROOT/ue/project/" "$TARGET/"

# car parts + PBR texture sources ride along (Import/ is regenerable via
# cars/AstonDB4_Unreal_Environment/Tools/split_car_glb.py)
if [ -d "$DB4/Import" ]; then
  rsync -a "$DB4/Import/" "$TARGET/Import/"
fi

echo "project -> $TARGET/BlueHour.uproject"
echo
echo "Build the C++ module (first open does this automatically):"
echo "  \"/Volumes/One Touch/Unreal-Engine/UE_5.8/Engine/Build/BatchFiles/Mac/Build.sh\" \\"
echo "    BlueHourEditor Mac Development -Project=\"$TARGET/BlueHour.uproject\""
echo
echo "Then: open the project, Tools -> Execute Python Script:"
echo "  1. $ROOT/ue/tools/ue_setup.py      # world + lighting + foliage"
echo "  2. $TARGET/Content/Python/setup_db4.py  # car + PBR materials"
