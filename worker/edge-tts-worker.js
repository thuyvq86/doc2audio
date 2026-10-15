/**
 * Doc2Audio — Cloudflare Worker proxy cho edge-tts (giọng Microsoft Neural, có Nam Minh).
 * Giúp trang web tĩnh (GitHub Pages) gọi được edge-tts ONLINE, không cần helper trên máy.
 *
 * Deploy: dash.cloudflare.com → Workers & Pages → Create → Worker → dán toàn bộ file này → Deploy.
 * Dùng: trong app chọn giọng "edge-tts", dán URL Worker (…​.workers.dev) vào ô endpoint.
 *
 * API:
 *   GET  /health         -> {"ok":true}
 *   POST /tts  {text, voice, rate, pitch} -> audio/mpeg (MP3)
 */

const TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION = "1-130.0.2849.68";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

// Token Sec-MS-GEC (giống thuật toán của edge-tts, tính theo float64 như Python).
async function secMsGec() {
  let ticks = Date.now() / 1000 + 11644473600;
  ticks -= ticks % 300;          // làm tròn xuống 5 phút
  ticks *= 1e7;                   // giây -> đơn vị 100ns
  const data = new TextEncoder().encode(ticks.toFixed(0) + TRUSTED);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildSSML(text, voice, rate, pitch) {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>` +
         `<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${escapeXml(text)}</prosody></voice></speak>`;
}

// Chia văn bản dài thành đoạn <= max ký tự, cắt theo câu.
function splitText(text, max = 1800) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?…\n]+[.!?…]*\s*/g) || [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function synthOne(text, voice, rate, pitch) {
  const gec = await secMsGec();
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
              `?TrustedClientToken=${TRUSTED}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}`;
  const resp = await fetch(url, {
    headers: {
      Upgrade: "websocket",
      "User-Agent": UA,
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const ws = resp.webSocket;
  if (!ws) throw new Error("WS upgrade thất bại (HTTP " + resp.status + ")");
  ws.accept();

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 30000);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) { clearTimeout(timer); resolve(); try { ws.close(); } catch {} }
      } else {
        const buf = ev.data; // ArrayBuffer
        const headerLen = new DataView(buf).getUint16(0);
        chunks.push(new Uint8Array(buf, 2 + headerLen));
      }
    });
    ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WS error")); });
  });

  const ts = new Date().toString();
  ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
  const reqId = crypto.randomUUID().replace(/-/g, "");
  ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n` +
    buildSSML(text, voice, rate, pitch));

  await finished;
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    const url = new URL(req.url);
    if (url.pathname.endsWith("/health")) {
      return new Response('{"ok":true}', { headers: cors({ "Content-Type": "application/json" }) });
    }
    if (req.method !== "POST") return new Response("POST /tts", { status: 405, headers: cors() });
    try {
      const body = await req.json();
      const text = (body.text || "").trim();
      const voice = body.voice || "vi-VN-NamMinhNeural";
      const rate = body.rate || "+0%";
      const pitch = body.pitch || "+0Hz";
      if (!text) return new Response("empty text", { status: 400, headers: cors() });

      const parts = [];
      for (const piece of splitText(text)) parts.push(await synthOne(piece, voice, rate, pitch));
      const len = parts.reduce((a, c) => a + c.length, 0);
      if (!len) throw new Error("không nhận được audio");
      const out = new Uint8Array(len);
      let off = 0;
      for (const c of parts) { out.set(c, off); off += c.length; }
      return new Response(out, { headers: cors({ "Content-Type": "audio/mpeg" }) });
    } catch (e) {
      return new Response("TTS error: " + (e && e.message || e), { status: 500, headers: cors() });
    }
  },
};
