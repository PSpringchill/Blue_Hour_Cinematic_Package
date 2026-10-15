#!/usr/bin/env python3
"""Blue Hour dev server — static files with no-cache headers.

Usage:  python3 serve.py [port]      (default 8765)

Unlike `python3 -m http.server`, every response carries
`Cache-Control: no-cache` so Safari/Chrome always revalidate and
never run stale JS after an update. Expected client disconnects
(browser aborting a GLB download on tab close) are logged quietly.
"""
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser aborted a download on tab close


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = Server(('127.0.0.1', port), Handler)
    print(f'Blue Hour dev server → http://127.0.0.1:{port}/')
    print('  game:   /      engine: /engine/      Ctrl+C to stop')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
