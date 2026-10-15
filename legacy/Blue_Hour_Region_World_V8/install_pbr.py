#!/usr/bin/env python3
"""Install locally downloaded (licensed) PBR diffuse, GL-normal and roughness maps.

Usage:
  python3 install_pbr.py asphalt.zip forest.zip [--gravel gravel.zip] [--mud mud.zip] [--rock rock.zip]

Inputs can also be extracted directories. Existing manifest fields are preserved
when optional materials are omitted. No remote content is downloaded.
"""
import argparse
import json
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "assets" / "textures"
EXT = {".png", ".jpg", ".jpeg", ".webp"}


def candidates(names, kind):
    hits = []
    for name in names:
        p = Path(name)
        if p.suffix.lower() not in EXT:
            continue
        stem = p.stem.lower()
        if kind == "color":
            match = re.search(r"(^|_)(diff|albedo|basecolor|color|col)(_|$)", stem)
        elif kind == "normal":
            match = re.search(r"(^|_)(nor_gl|normal_gl|normal_opengl)(_|$)", stem)
        else:
            match = re.search(r"(^|_)(rough)(_|$)", stem)
            if any(word in stem for word in ("rough_ao", "roughao", "arm", "metal")):
                match = None
        if not match:
            continue
        tier = next((i for i, k in enumerate(("2k", "1k", "4k", "8k"))
                     if re.search(r"(^|_)"+k+r"(_|$)", stem)), 4)
        hits.append(((tier, len(name)), name))
    return [n for _, n in sorted(hits)]


def install(kind, supplied):
    source = Path(supplied).expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(source)
    is_zip = zipfile.is_zipfile(source)
    archive = zipfile.ZipFile(source) if is_zip else None
    try:
        if archive:
            names = [n for n in archive.namelist() if not n.endswith("/")]
        elif source.is_dir():
            names = [str(p.relative_to(source)) for p in source.rglob("*") if p.is_file()]
        else:
            raise ValueError(f"Expected a ZIP or directory: {source}")
        result = {}
        outfolder = TARGET / kind
        outfolder.mkdir(parents=True, exist_ok=True)
        for role in ("color", "normal", "roughness"):
            choices = candidates(names, role)
            if not choices:
                raise ValueError(f"{source}: missing {role}. Select color, Normal(GL) and roughness maps.")
            name = choices[0]
            dest = outfolder / (role + Path(name).suffix.lower())
            # Only write to a fixed local destination; do not extract arbitrary paths.
            with (archive.open(name) if archive else open(source / name, "rb")) as inp:
                with open(dest, "wb") as out:
                    shutil.copyfileobj(inp, out)
            result[role] = "./assets/textures/" + kind + "/" + dest.name
            print(f"{kind}/{role}: {name}")
        return result
    finally:
        if archive:
            archive.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asphalt", help="asphalt PBR ZIP or folder")
    parser.add_argument("forest", help="forest soil PBR ZIP or folder")
    parser.add_argument("--gravel", help="optional gravel PBR ZIP or folder")
    parser.add_argument("--mud", help="optional wet earth PBR ZIP or folder")
    parser.add_argument("--rock", help="optional scanned rock PBR ZIP or folder")
    a = parser.parse_args()
    TARGET.mkdir(parents=True, exist_ok=True)
    mf = TARGET / "manifest.json"
    manifest = json.loads(mf.read_text()) if mf.exists() else {}
    for kind, source in (("road", a.asphalt), ("forest", a.forest),
                         ("gravel", a.gravel), ("mud", a.mud), ("rock", a.rock)):
        if source:
            manifest[kind] = install(kind, source)
    mf.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Installed {len(manifest)} scanned PBR surface families: {mf}")


if __name__ == "__main__":
    main()
