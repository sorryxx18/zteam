"""Local-only Chrome smoke test. Requires websocket-client and Chrome on macOS.
Run: python3 tests/command-browser.py (starts its own loopback HTTP server).
"""
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.request
import websocket

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/'
with tempfile.TemporaryDirectory(prefix='command-smoke-') as profile:
    proc = None
    ws = None
    try:
        proc = subprocess.Popen([CHROME, '--headless=new', '--no-first-run', '--no-default-browser-check',
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        portfile = Path(profile) / 'DevToolsActivePort'
        for _ in range(100):
            if portfile.exists():
                break
            time.sleep(.1)
        port = portfile.read_text().splitlines()[0]
        targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=5))
        ws = websocket.create_connection(next(t['webSocketDebuggerUrl'] for t in targets if t['type'] == 'page'), suppress_origin=True, timeout=20)
        seq = 0
        errors = []
        def call(method, params=None):
            global seq
            seq += 1
            ws.send(json.dumps({'id': seq, 'method': method, 'params': params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get('method') == 'Runtime.exceptionThrown':
                    errors.append(msg['params'])
                if msg.get('id') == seq:
                    assert 'error' not in msg, msg
                    return msg.get('result', {})
        def evaluate(expression):
            result = call('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
            assert 'exceptionDetails' not in result, result
            return result.get('result', {}).get('value')
        def wait(expression):
            for _ in range(100):
                if evaluate(expression):
                    return
                time.sleep(.1)
            raise AssertionError('Timed out: ' + expression)
        def screenshot(name):
            data = call('Page.captureScreenshot', {'format': 'png'})['data']
            Path('/tmp/' + name).write_bytes(base64.b64decode(data))
        call('Page.enable')
        call('Runtime.enable')
        call('Network.enable')
        # No backend access or writes from smoke testing.
        call('Network.setBlockedURLs', {'urls': ['*script.google.com*', '*script.googleusercontent.com*']})
        call('Emulation.setDeviceMetricsOverride', {'width': 1920, 'height': 1080, 'deviceScaleFactor': 1, 'mobile': False})
        # Hold the real style response until after clicking the entry: exercise stale activity work.
        call('Page.addScriptToEvaluateOnNewDocument', {'source': '''
          const realFetch = window.fetch;
          const styleGate = new Promise(resolve => { window.releaseActivityStyle = resolve; });
          window.fetch = (...args) => {
            const response = realFetch(...args);
            if (String(args[0]).includes('tiles.openfreemap.org/styles/liberty')) {
              window.activityStylePending = true;
              return Promise.all([response, styleGate]).then(([r]) => r);
            }
            return response;
          };
        '''})
        call('Page.navigate', {'url': base + '?preview=1#activity'})
        wait('!!document.querySelector(\'[data-act="1151231"] a[href="#command"]\')')
        wait('window.activityStylePending === true')
        assert evaluate('!document.querySelector("#amapMap-1151231 canvas")')
        evaluate('document.querySelector(\'[data-act="1151231"] a[href="#command"]\').click()')
        wait('!!document.querySelector("#cmd")')
        evaluate('window.releaseActivityStyle()')
        assert evaluate('document.querySelector(".cmddemo").textContent') == '示意'
        wait('!!cmdMapObj && cmdMapObj.loaded()')
        assert evaluate('cmdMapObj.getSource("cmdzones")._data.features.length') == 8
        ratio = evaluate('document.querySelector("#cmdMap").getBoundingClientRect().width/document.querySelector(".cmdmain").getBoundingClientRect().width')
        print(json.dumps({'desktop_map_ratio': ratio}, ensure_ascii=False), flush=True)
        assert .66 <= ratio <= .73, ratio
        screenshot('command-demo.png')
        evaluate('COMMAND.demo=false; renderCommand()')
        wait('!!cmdMapObj && cmdMapObj.loaded()')
        assert evaluate('cmdMapObj.getSource("cmdzones") === undefined')
        assert evaluate('!document.querySelector(".cmddemo")')
        for element in ['cmdSide', 'cmdSocial', 'cmdCams', 'cmdNums', 'cmdPhase', 'cmdCount']:
            assert evaluate(f'document.getElementById("{element}").textContent.includes("待提供")'), element
        assert evaluate('!document.querySelector("#cmd").textContent.includes("松智路")')
        assert evaluate('Math.abs(cmdNow()-Date.now()) < 1000')
        assert evaluate('document.querySelector(".cmdnums").getBoundingClientRect().height <= 110'), 'missing values must not expand the number row'
        call('Emulation.setDeviceMetricsOverride', {'width': 1200, 'height': 1080, 'deviceScaleFactor': 1, 'mobile': False})
        assert evaluate('document.querySelector("#cmdMap").getBoundingClientRect().width/document.querySelector(".cmdmain").getBoundingClientRect().width >= .66'), 'map must stay around 70%'
        call('Emulation.setDeviceMetricsOverride', {'width': 1600, 'height': 1080, 'deviceScaleFactor': 1, 'mobile': False})
        screenshot('command-live.png')
        call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        evaluate('void cmdMapObj.resize()')
        assert evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile overflow'
        assert evaluate('[...document.querySelectorAll(".cmdnum.lights em")].every(el => el.scrollWidth <= el.clientWidth)'), 'mobile light labels clipped'
        screenshot('command-mobile.png')
        call('Page.navigate', {'url': base + '#command'})
        wait('document.readyState === "complete" && typeof renderCommand === "function"')
        assert evaluate('!document.querySelector("#cmd")'), 'route guard'
        assert not errors, errors
        print(json.dumps({'entry': 'PASS', 'demo_live_switch': 'PASS', 'empty_map': 'PASS', 'mobile': 'PASS', 'route_guard': 'PASS', 'runtime_errors': errors, 'screenshots': ['/tmp/command-demo.png', '/tmp/command-live.png', '/tmp/command-mobile.png']}, ensure_ascii=False))
    finally:
        if ws is not None:
            ws.close()
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        server.shutdown()
        server.server_close()
