/**
 * Doc2Audio — Cloudflare Worker proxy cho Google Cloud Text-to-Speech (giọng VN nam/nữ, chất lượng cao).
 * Thay cho edge-tts (bị Microsoft chặn IP Cloudflare).
 *
 * CẦN:
 *  1) Bật "Cloud Text-to-Speech API" trong Google Cloud, tạo 1 API key.
 *  2) Trong Worker: Settings → Variables and Secrets → thêm biến tên GOOGLE_TTS_KEY = <API key> (chọn Encrypt/Secret).
 *  3) Dán code này vào Worker → Deploy.
 *
 * API:  GET /health -> {ok, provider, hasKey}   |   POST /tts {text, voice, rate} -> audio/mpeg
 */

const VOICE_MAP = {
  "vi-VN-NamMinhNeural": "vi-VN-Wavenet-D", // nam
  "vi-VN-HoaiMyNeural":  "vi-VN-Wavenet-A", // nữ
};

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

function parseRate(r) {
  const m = /(-?\d+)\s*%/.exec(r || "");
  if (m) return Math.max(0.25, Math.min(4, 1 + (+m[1]) / 100));
  const n = parseFloat(r);
  return isFinite(n) && n > 0 ? Math.max(0.25, Math.min(4, n)) : 1;
}

function splitText(text, max = 4500) {
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

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function googleTTS(text, name, rate, key) {
  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "vi-VN", name },
      audioConfig: { audioEncoding: "MP3", speakingRate: rate },
    }),
  });
  if (!r.ok) throw new Error("Google TTS " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json();
  if (!j.audioContent) throw new Error("no audioContent");
  return b64ToBytes(j.audioContent);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    const url = new URL(req.url);
    if (url.pathname.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, provider: "google", hasKey: !!(env && env.GOOGLE_TTS_KEY) }),
        { headers: cors({ "Content-Type": "application/json" }) });
    }
    if (req.method !== "POST") return new Response("POST /tts", { status: 405, headers: cors() });
    const key = env && env.GOOGLE_TTS_KEY;
    if (!key) return new Response("Thiếu GOOGLE_TTS_KEY trong Worker (Settings → Variables).", { status: 500, headers: cors() });
    try {
      const body = await req.json();
      const text = (body.text || "").trim();
      if (!text) return new Response("empty text", { status: 400, headers: cors() });
      const name = VOICE_MAP[body.voice] || body.voice || "vi-VN-Wavenet-D";
      const rate = parseRate(body.rate);

      const parts = [];
      for (const piece of splitText(text)) parts.push(await googleTTS(piece, name, rate, key));
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
