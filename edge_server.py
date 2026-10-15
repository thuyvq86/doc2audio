#!/usr/bin/env python3
"""
Helper tùy chọn cho Doc2Audio — chỉ cần khi muốn giọng edge-tts (tự nhiên nhất).
Chạy trên MÁY CỦA BẠN, không gửi gì ra ngoài trừ lời gọi tới dịch vụ đọc của Microsoft.

Cài 1 lần:   pip3 install --user edge-tts
Chạy:        python3 edge_server.py
Rồi trong web tool chọn giọng "edge-tts".

Dừng: Ctrl+C.
"""
import asyncio, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import edge_tts
except ImportError:
    raise SystemExit("Thiếu edge-tts. Chạy:  pip3 install --user edge-tts")

PORT = 5005

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            self.send_response(200); self._cors()
            self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404); self._cors(); self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/tts"):
            self.send_response(404); self._cors(); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        text = (body.get("text") or "").strip()
        voice = body.get("voice") or "vi-VN-NamMinhNeural"
        rate = body.get("rate") or "+0%"
        if not text:
            self.send_response(400); self._cors(); self.end_headers(); return
        try:
            audio = asyncio.run(self._synth(text, voice, rate))
        except Exception as e:
            self.send_response(500); self._cors()
            self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(str(e).encode()); return
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "audio/mpeg"); self.end_headers()
        self.wfile.write(audio)

    async def _synth(self, text, voice, rate):
        buf = bytearray()
        # Chia theo đoạn để ổn định với văn bản dài.
        for para in [p for p in text.split("\n") if p.strip()]:
            com = edge_tts.Communicate(para.strip(), voice, rate=rate)
            async for ch in com.stream():
                if ch["type"] == "audio":
                    buf.extend(ch["data"])
        return bytes(buf)

    def log_message(self, *a):  # im lặng
        pass

if __name__ == "__main__":
    print(f"Doc2Audio edge-tts helper đang chạy tại http://127.0.0.1:{PORT}")
    print("Giữ cửa sổ này mở khi dùng giọng edge-tts. Ctrl+C để dừng.")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
