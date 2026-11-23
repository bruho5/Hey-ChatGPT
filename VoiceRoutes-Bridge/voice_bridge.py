"""Private loopback event bridge. Uses the adjacent offline VoiceRoutes probe."""
import argparse
from contextlib import redirect_stdout
import io
from collections import deque
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import re
import secrets
import threading
import tempfile
import time

ADDRESS = ('127.0.0.1', 18765)
ORIGIN = re.compile(r'chrome-extension://[a-p]{32}')
ROUTE_ID = re.compile(r'r(?:[0-9]|1[0-5])')
# Split at ASCII/Han boundaries, whether or not the display phrase has a space.
# Do not drop unrecognized characters, guess the sound of English OOV words, or
# let raw display labels leak into Sherpa's keywords file.
LEXEMES = re.compile(r"[\u4e00-\u9fff]+|[A-Za-z]+(?:'[A-Za-z]+)*| +")
CHATGPT_PHONETIC_WORDS = ('CHAT', 'G', 'P', 'T')
PERIOD = 0.2
MAX_BODY = 16384


class EventBuffer:
    def __init__(self, limit=128):
        self.events = deque(maxlen=limit)
        self.cursor = 0
        self.lock = threading.Lock()

    def add(self, **payload):
        with self.lock:
            self.cursor += 1
            self.events.append(dict(id=self.cursor, at=time.time_ns() // 1_000_000, **payload))

    def wake(self, route_id, phrase):
        self.add(type='wake', routeId=route_id, phrase=phrase)

    def clear(self):
        with self.lock:
            self.events.clear()
            return self.cursor

    def snapshot(self, after):
        with self.lock:
            return dict(cursor=self.cursor, connected=True,
                        events=[item for item in self.events if item['id'] > after])


class RouteCompiler:
    def __init__(self, tokens, lexicon, text2token):
        self.tokens = tokens
        self.lexicon = lexicon
        self.text2token = text2token
        self.words = {line.split()[0] for line in lexicon.read_text(encoding='utf-8').splitlines() if line.strip()}
        self.allowed = {line.split()[0] for line in tokens.read_text(encoding='utf-8').splitlines() if line.strip()}

    def normalize(self, label, idx):
        segments = []
        end = 0
        for match in LEXEMES.finditer(label):
            if match.start() != end:
                break
            end = match.end()
            part = match[0]
            if part[0] == ' ':
                continue
            han = '\u4e00' <= part[0] <= '\u9fff'
            if han and segments and segments[-1][0]:
                segments[-1] = (True, segments[-1][1] + part)
            else:
                segments.append((han, part if han else part.upper()))
        if end != len(label) or not segments:
            raise ValueError(f'第 {idx} 条只支持普通话汉字、英语字母和空格。英文单词内可用英文撇号；不支持数字、其他标点或表情。')
        words = []
        for han, part in segments:
            if han:
                words.append(part)
                continue
            english = CHATGPT_PHONETIC_WORDS if part == 'CHATGPT' else (part,)
            if any(word not in self.words for word in english):
                raise ValueError(f'第 {idx} 条含本地英语词典未收录的词，请换一种说法。')
            words.extend(english)
        return ' '.join(words)

    def compile(self, routes):
        if not isinstance(routes, list) or len(routes) > 16:
            raise ValueError('最多可以设置 16 条唤醒口令。')
        result = {}
        seen = set()
        for idx, route in enumerate(routes, 1):
            if not isinstance(route, dict):
                raise ValueError(f'第 {idx} 条口令格式不正确。')
            identity, label = route.get('id'), route.get('text')
            if not isinstance(identity, str) or not ROUTE_ID.fullmatch(identity) or identity in result:
                raise ValueError(f'第 {idx} 条口令的编号不正确或重复。')
            intent = route.get('intent')
            if 'intent' in route and (identity != 'r15' or intent != 'send'):
                raise ValueError(f'第 {idx} 条口令用途不正确。')
            if not isinstance(label, str) or not 1 <= len(label) <= 80 or label != label.strip():
                raise ValueError(f'第 {idx} 条请输入 1 到 80 字的口令，不要在首尾加空格。')
            normalized = self.normalize(label, idx)
            # Pinned Sherpa may describe bad input on stdout; do not echo it to the console.
            with redirect_stdout(io.StringIO()):
                sequences = self.text2token([normalized], tokens=str(self.tokens),
                                           tokens_type='phone+ppinyin', lexicon=str(self.lexicon))
            if len(sequences) != 1 or not sequences[0] or any(t not in self.allowed or t.startswith('<') for t in sequences[0]):
                raise ValueError(f'第 {idx} 条含模型不支持的读音，请换一种说法。')
            phones = tuple(sequences[0])
            if phones in seen:
                raise ValueError(f'第 {idx} 条和另一条口令读音相同，请换一种说法。')
            seen.add(phones)
            result[identity] = (label, phones, intent)
        return result


class Configuration:
    def __init__(self, compiler, load_spotter, events):
        self.compiler, self.load_spotter, self.events = compiler, load_spotter, events
        self.lock = threading.Lock()
        self.current = (None, None, {})
        self.routes = None

    def configure(self, routes):
        compiled = self.compiler.compile(routes)
        with self.lock:
            if compiled == self.routes:
                return self.events.snapshot(0)['cursor']
        spotter = stream = None
        if compiled:
            try:
                with tempfile.TemporaryDirectory(prefix='voice-routes-') as tmp:
                    path = Path(tmp) / 'keywords.txt'
                    # The only identifier serialized after @ is a validated ASCII route ID.
                    path.write_text(''.join(f"{' '.join(phones)}{' #0.55' if intent == 'send' else ''} @{identity}\n"
                                           for identity, (_, phones, intent) in compiled.items()), encoding='utf-8')
                    spotter = self.load_spotter(path)
                    stream = spotter.create_stream()
            except (RuntimeError, OSError, ValueError) as exc:
                raise ValueError('无法载入新口令；原来的配置未改变。') from exc
        with self.lock:
            self.current = (spotter, stream, {k: v[0] for k, v in compiled.items()})
            self.routes = compiled
            return self.events.clear()

    def consume(self, sr, samples, decode):
        with self.lock:
            current = self.current
        spotter, stream, labels = current
        if spotter is None:
            return
        stream.accept_waveform(sr, samples)
        for routeid in decode(spotter, stream):
            with self.lock:
                if current is self.current and routeid in labels:
                    self.events.wake(routeid, labels[routeid])


class AudioGate:
    """RMS gate, not a classifier. A stale or missing block is never speech."""
    def __init__(self, floor_db=-43, margin_db=10):
        self.floor_db, self.margin_db = floor_db, margin_db
        self.noise_db = -60.0
        self.lock = threading.Lock()
        self.blocks = deque(maxlen=5)

    def add(self, rms_db, captured):
        with self.lock:
            self.blocks.append((rms_db, captured))

    def take(self, now):
        with self.lock:
            fresh = [db for db, captured in self.blocks if 0 <= now - captured <= 0.35]
            self.blocks.clear()
        if not fresh:
            return False
        db = max(fresh)
        speech = db >= max(self.floor_db, self.noise_db + self.margin_db)
        if not speech:
            self.noise_db += 0.1 * (min(-20.0, max(-80.0, db)) - self.noise_db)
        return speech


class BridgeServer(HTTPServer):
    allow_reuse_address = False

    def get_request(self):
        sock, addr = super().get_request()
        sock.settimeout(1.0)
        return sock, addr

    def handle_error(self, request, client_address):
        # Do not print request payloads, credentials, or client details.
        pass


def handler_for(token, events, address, configure=None):
    host = f'{address[0]}:{address[1]}'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def safe_origin(self):
            origins = self.headers.get_all('Origin', [])
            hosts = self.headers.get_all('Host', [])
            if hosts != [host] or len(origins) != 1 or not ORIGIN.fullmatch(origins[0]):
                return None
            return origins[0]

        def reply(self, status, payload=None, origin=None, preflight=False):
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else b''
            self.send_response(status)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            if origin:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            if preflight:
                self.send_header('Access-Control-Allow-Methods', 'POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                    self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_OPTIONS(self):
            origin = self.safe_origin()
            if not origin or self.path not in ('/events', '/configure') or self.headers.get('Access-Control-Request-Method') != 'POST':
                return self.reply(403)
            self.reply(204, origin=origin, preflight=True)

        def do_POST(self):
            origin = self.safe_origin()
            if not origin:
                return self.reply(403)
            if self.path not in ('/events', '/configure'):
                return self.reply(404, origin=origin)
            lengths = self.headers.get_all('Content-Length', [])
            try:
                if self.headers.get_content_type() != 'application/json' or len(lengths) != 1 or self.headers.get('Transfer-Encoding'):
                    raise ValueError
                length = int(lengths[0])
                if not 0 < length <= MAX_BODY:
                    raise ValueError
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError
            except (ValueError, TimeoutError, RecursionError):
                return self.reply(400, origin=origin)
            provided = payload.get('token')
            if not isinstance(provided, str) or not provided.isascii() or not secrets.compare_digest(token, provided):
                return self.reply(401, origin=origin)
            if self.path == '/configure':
                if configure is None:
                    return self.reply(404, origin=origin)
                try:
                    cursor = configure(payload.get('routes'))
                except ValueError as exc:
                    return self.reply(400, dict(error=str(exc)), origin=origin)
                return self.reply(200, dict(ok=True, cursor=cursor, sendGuard=True), origin=origin)
            after = payload.get('after')
            if type(after) is not int or after < 0:
                return self.reply(400, origin=origin)
            self.reply(200, events.snapshot(after), origin=origin)

    return Handler


def open_server(address, token, events, configure=None):
    server = BridgeServer(address, BaseHTTPRequestHandler)
    server.RequestHandlerClass = handler_for(token, events, server.server_address, configure)
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', type=int, help='PortAudio input device index')
    parser.add_argument('--floor-db', type=float, default=-43, help='RMS dBFS gate floor')
    args = parser.parse_args()
    import numpy as np
    import sounddevice as sd
    import probe
    from sherpa_onnx.utils import text2token
    lexicon = Path(probe.MODEL) / 'en.phone'
    if not lexicon.is_file():
        lexicon = Path(__file__).with_name('en.phone')  # Existing private installations.
    compiler = RouteCompiler(Path(probe.MODEL) / 'tokens.txt', lexicon, text2token)
    info = sd.query_devices(args.device, 'input')
    sr = int(info['default_samplerate'])
    token = secrets.token_urlsafe(32)
    events = EventBuffer()
    configuration = Configuration(compiler, probe.load_spotter, events)
    gate = AudioGate(args.floor_db)
    closed = threading.Event()

    def audio_ticks():
        while not closed.wait(PERIOD):
            events.add(type='audio', speech=gate.take(time.monotonic()))

    with open_server(ADDRESS, token, events, configuration.configure) as server:
        with sd.InputStream(device=args.device, channels=1, dtype='float32', samplerate=sr) as mic:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            threading.Thread(target=audio_ticks, daemon=True).start()
            print(f'Voice Routes 本机桥接： http://{ADDRESS[0]}:{ADDRESS[1]}')
            print(f'麦克风：{info["name"]}（{sr} Hz）')
            print(f'本次连接码：{token}')
            print(f'本机 RMS 音量门（最低 {args.floor_db:g} dBFS，另参考底噪＋10 dB）；响声也可能触发，不是语音内容识别。')
            print('仅本机内存处理，不保存或上传音频，不发送消息。Ctrl+C 停止。', flush=True)
            try:
                while True:
                    frames, overflow = mic.read(max(1, sr // 10))
                    captured = time.monotonic()
                    samples = frames[:, 0].copy()
                    if samples.size and not overflow:
                        level = 20 * np.log10(max(1e-5, float(np.sqrt(np.mean(np.square(samples))))))
                        gate.add(float(level), captured)
                    if samples.size:
                        configuration.consume(sr, samples, probe.decode)
            except KeyboardInterrupt:
                print('\n监听已停止。')
            finally:
                closed.set()
                server.shutdown()


if __name__ == '__main__':
    main()
