/**
 * Doc2Audio — Cloudflare Worker proxy cho edge-tts (giọng Microsoft Neural, có Nam Minh).
 * Tự lấy phiên bản Edge mới nhất từ Microsoft để khỏi phải sửa tay token version.
 *
 * Deploy: dash.cloudflare.com → Workers & Pages → Create → Worker → dán toàn bộ file này → Deploy.
 * API:  GET /health -> {ok,version}   |   POST /tts {text,voice,rate,pitch} -> audio/mpeg
 */

const TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const FALLBACK_VERSION = "143.0.3650.75"; // dùng khi không fetch được version mới

function uaFor(ver) {
  const major = ver.split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;
}

// Cache version trong isolate (best-effort) — tự fetch lại sau 6 giờ.
let _ver = { v: FALLBACK_VERSION, t: 0 };
async function getEdgeVersion() {
  const now = Date.now();
  if (_ver.t && now - _ver.t < 6 * 3600 * 1000) return _ver.v;
  try {
    const r = await fetch("https://edgeupdates.microsoft.com/api/products?view=enterprise", {
      headers: { "Accept": "application/json", "User-Agent": uaFor(FALLBACK_VERSION) },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    const data = await r.json();
    const stable = data.find((p) => (p.Product || "").toLowerCase() === "stable");
    const rels = (stable && stable.Releases) || [];
    const rel = rels.find((x) => x.Platform === "Windows" && x.Architecture === "x64") || rels[0];
    if (rel && rel.ProductVersion) _ver = { v: rel.ProductVersion, t: now };
  } catch { /* giữ version cũ / fallback */ }
  return _ver.v;
}

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

async function secMsGec() {
  let ticks = Date.now() / 1000 + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
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
  const ver = await getEdgeVersion();
  const gec = await secMsGec();
  const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
              `?TrustedClientToken=${TRUSTED}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${ver}`;
  const resp = await fetch(url, {
    headers: {
      Upgrade: "websocket",
      "User-Agent": uaFor(ver),
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const ws = resp.webSocket;
  if (!ws) throw new Error("WS upgrade failed (HTTP " + resp.status + ")");
  ws.accept();

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 30000);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) { clearTimeout(timer); resolve(); try { ws.close(); } catch {} }
      } else {
        const buf = ev.data;
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
      const v = await getEdgeVersion();
      return new Response(JSON.stringify({ ok: true, version: v }), { headers: cors({ "Content-Type": "application/json" }) });
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
      if (!len) throw new Error("no audio");
      const out = new Uint8Array(len);
      let off = 0;
      for (const c of parts) { out.set(c, off); off += c.length; }
      return new Response(out, { headers: cors({ "Content-Type": "audio/mpeg" }) });
    } catch (e) {
      return new Response("TTS error: " + (e && e.message || e), { status: 500, headers: cors() });
    }
  },
};
