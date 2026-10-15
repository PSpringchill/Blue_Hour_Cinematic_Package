#!/usr/bin/env python3
"""Blue Hour recheck — verifies the live app and the new engine.

Stages:
  1. syntax     node --check every JS module in src/ and engine/
  2. assets     HTTP 200 on pages, modules and required assets;
                known-optional files must 404 cleanly (fallback path)
  3. boot       headless Chrome reaches the playable/HUD state and
                reports zero application JS errors
  4. telemetry  ?autotest drives and reports heap/draw stats

Usage:  python3 tests/recheck.py [--port 8799] [--skip-boot]
A self-contained HTTP server is started on a free port; Chrome is
located automatically. Exits non-zero if any required check fails.
"""
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = []

def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}"
          + (f"  — {detail}" if detail else ""))
    return ok

# ------------------------------------------------------------------
def syntax_stage():
    print("\n[1] syntax — node --check")
    files = sorted(list((ROOT / 'src').rglob('*.js')) +
                   list((ROOT / 'engine' / 'src').rglob('*.js')))
    check('modules found', len(files) >= 20, f"{len(files)} files")
    for f in files:
        r = subprocess.run(['node', '--check', str(f)],
                           capture_output=True, text=True)
        check(f.relative_to(ROOT).as_posix(),
              r.returncode == 0,
              r.stderr.strip().splitlines()[-1] if r.stderr else "")

# ------------------------------------------------------------------
def serve(port):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def handle(self):
            try:
                super().handle()
            except (BrokenPipeError, ConnectionResetError):
                pass            # Chrome aborts mid-download on teardown
    class S(http.server.ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            pass
    srv = S(('127.0.0.1', port), Q)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def http_code(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0

def assets_stage(port):
    print("\n[2] assets — HTTP status")
    base = f'http://127.0.0.1:{port}'
    required = [
        '/index.html', '/src/main.js', '/src/core/config.js',
        '/src/core/stream.js', '/src/render/proctex.js',
        '/engine/', '/engine/src/app/main.js',
        '/engine/src/ui/hud.js', '/engine/src/render/environment.js',
        '/regions/index.json',
        '/trees/spruce.glb', '/trees/birch_lod2.glb',
        '/cars/aston_db4.glb', '/cars/mustang_lod.glb',
        '/scenery/mountain.glb', '/scenery/grass.glb',
        '/assets/terrain/ground_albedo.webp',
    ]
    for path in required:
        code = http_code(base + path)
        check(f'GET {path}', code == 200, f'HTTP {code}')
    optional = [
        '/assets/textures/ktx2_manifest.json',
        '/assets/textures/impostor_manifest.json',
        '/scenery/rock.glb',
    ]
    for path in optional:
        code = http_code(base + path)
        check(f'GET {path} (optional->fallback)', code == 404,
              f'HTTP {code}')

# ------------------------------------------------------------------
def chrome():
    for p in ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              shutil.which('google-chrome'), shutil.which('chromium')]:
        if p and Path(p).exists(): return p
    return None

JS_ERRORS = re.compile(
    r'Uncaught|SyntaxError|ReferenceError|TypeError|Failed to fetch')

def boot_run(bin, url, wait, tag):
    """Launch headless Chrome, collect stderr for `wait` seconds."""
    prof = tempfile.mkdtemp(prefix='bh_t_')
    proc = subprocess.Popen([
        bin, '--headless=new', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--enable-logging=stderr', '--v=0',
        '--window-size=1024,600', f'--user-data-dir={prof}', url
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(wait)
    proc.terminate()
    try: out, _ = proc.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill(); out, _ = proc.communicate()
    shutil.rmtree(prof, ignore_errors=True)
    (Path(tempfile.gettempdir()) / f'bh_test_{tag}.log').write_text(out)
    return out

def dom_run(bin, url):
    prof = tempfile.mkdtemp(prefix='bh_d_')
    r = subprocess.run([
        bin, '--headless=new', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--timeout=25000', '--dump-dom',
        '--window-size=1024,600', f'--user-data-dir={prof}', url
    ], capture_output=True, text=True, timeout=90)
    shutil.rmtree(prof, ignore_errors=True)
    return r.stdout

def boot_stage(port):
    print("\n[3] boot — headless Chrome")
    bin = chrome()
    if not check('chrome binary', bin is not None):
        return
    base = f'http://127.0.0.1:{port}'

    dom = dom_run(bin, base + '/?autotest')
    check('app start enabled', '<button id="start">START ENGINE' in dom)

    dom = dom_run(bin, base + '/engine/')
    check('engine HUD mounted', 'BLUE HOUR' in dom and 'stage PBR' in dom)
    check('engine preset button', 'LIGHT: ' in dom)

    out = boot_run(bin, base + '/?autotest', 40, 'app')
    errs = [l for l in out.splitlines() if JS_ERRORS.search(l)
            and 'CONSOLE' in l]
    check('app: zero JS errors', not errs,
          errs[0][:120] if errs else '')
    tests = []
    for line in out.splitlines():
        if 'AUTOTEST' in line and '{' in line and '}' in line:
            blob = line[line.index('{'):line.rindex('}') + 1]
            if blob:
                try: tests.append(json.loads(blob))
                except Exception: pass
    check('app: autotest telemetry', len(tests) >= 2,
          f'{len(tests)} samples')
    if tests:
        t = tests[-1]
        check('app: driving', t.get('kmh', 0) > 10,
              f"{t.get('kmh')} km/h")
        check('app: heap sane', t.get('heapMB', 9e9) < 400,
              f"{t.get('heapMB')} MB")

# ------------------------------------------------------------------
def main():
    skip_boot = '--skip-boot' in sys.argv
    port = 8799
    for i, a in enumerate(sys.argv):
        if a == '--port' and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    os.chdir(ROOT)
    srv = serve(port)
    try:
        syntax_stage()
        assets_stage(port)
        if not skip_boot:
            boot_stage(port)
    finally:
        srv.shutdown()
    fails = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{'=' * 50}\n{len(RESULTS) - len(fails)} passed, "
          f"{len(fails)} failed")
    for n in fails: print('  FAIL:', n)
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
