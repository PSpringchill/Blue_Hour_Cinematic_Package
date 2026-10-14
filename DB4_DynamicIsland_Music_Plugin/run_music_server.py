#!/usr/bin/env python3
"""Development host for YouTube embeds in Unreal. Loopback only, no external binding."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent / 'Plugins' / 'DB4MusicIsland' / 'Resources' / 'Web'
# 8765 is the Blue Hour dev server's port — the music island lives on
# 8766 by default and scans upward if that is taken too.
PORTS = range(8766, 8776)

class MusicHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

if __name__ == '__main__':
    import sys
    server = None
    for port in PORTS:
        try:
            server = ThreadingHTTPServer(
                ('127.0.0.1', port),
                partial(MusicHandler, directory=str(WEB_ROOT)))
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f'All ports {PORTS.start}-{PORTS.stop - 1} are in use.')
    print(f'DB4 Music Island: http://127.0.0.1:{port}/')
    print('Use this URL in ShowMusicIsland. Keep this terminal open while playing.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
