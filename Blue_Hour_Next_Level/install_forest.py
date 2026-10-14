#!/usr/bin/env python3
"""Install 1-2 static, locally sourced tree GLB models as instanced forest species.

Usage: python3 install_forest.py ~/Downloads/spruce.glb [~/Downloads/pine.glb]

Assets must be Y-up and composed of 1-4 static mesh parts (no rig/skin).
GLB must contain geometry; diffuse/normal/alpha maps should be embedded.
"""
import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "assets" / "models"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trees", nargs="+", help="one or two .glb files")
    a = parser.parse_args()
    if not 1 <= len(a.trees) <= 2:
        parser.error("Use between one and two static tree .glb assets")
    TARGET.mkdir(parents=True, exist_ok=True)
    entries = []
    for i, candidate in enumerate(a.trees):
        path = Path(candidate).expanduser().resolve()
        if not path.is_file() or path.suffix.lower() != ".glb":
            raise ValueError(f"Not a GLB file: {path}")
        with path.open("rb") as f:
            if f.read(4) != b"glTF":
                raise ValueError(f"GLB header not recognized: {path}")
        name = re.sub(r"[^a-zA-Z0-9_-]", "_", path.stem)[:60]
        dest = TARGET / f"{i+1}_{name}.glb"
        shutil.copyfile(path, dest)
        entries.append({"path": f"./assets/models/{dest.name}"})
        print("Copied:", dest)
    mf = TARGET / "manifest.json"
    mf.write_text(json.dumps({"trees": entries}, indent=2) + "\n")
    print(f"Manifest ready: {mf}. Trees auto-load when the game starts.")


if __name__ == "__main__":
    main()
