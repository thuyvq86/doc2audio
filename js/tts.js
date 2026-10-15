// Ba cỗ máy đọc: Piper (offline, WASM) · Web Speech (giọng hệ điều hành) · edge-tts (helper/Worker).
import * as piper from "https://esm.run/@diffusionstudio/vits-web";

export const EDGE_URL = "http://127.0.0.1:5005"; // mặc định: helper trên máy

// Endpoint edge-tts: ưu tiên URL đã lưu (vd Cloudflare Worker online), nếu không thì helper local.
export function getEdgeBase() {
  try { return (localStorage.getItem("d2a-edge-url") || "").trim() || EDGE_URL; }
  catch { return EDGE_URL; }
}
export function setEdgeBase(u) {
  try { localStorage.setItem("d2a-edge-url", (u || "").trim().replace(/\/+$/, "")); } catch {}
}

// Piper tiếng Việt (offline) — thực tế chỉ có giọng nữ; chất lượng vừa phải.
export const PIPER_VOICES = [
  { id: "vi_VN-vais1000-medium",      label: "vais1000 — nữ, chất lượng tốt nhất (mặc định)" },
  { id: "vi_VN-25hours_single-low",   label: "25hours — nữ, nhẹ" },
  { id: "vi_VN-vivos-x_low",          label: "vivos — chất lượng thấp, tải nhanh" },
];

// edge-tts — giọng tự nhiên nhất (cần helper hoặc Worker), có cả nam và nữ.
export const EDGE_VOICES = [
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh — nam, tự nhiên" },
  { id: "vi-VN-HoaiMyNeural",  label: "Hoài My — nữ, tự nhiên" },
];

/* ---------- PIPER (offline) ---------- */
export async function piperStored() { try { return await piper.stored(); } catch { return []; } }

export async function piperSynth(text, voiceId, onProgress = () => {}) {
  const stored = await piperStored();
  if (!stored.includes(voiceId)) {
    await piper.download(voiceId, (p) => onProgress(p.loaded / (p.total || 1), "Đang tải giọng Piper…"));
  }
  onProgress(0.98, "Đang tạo audio…");
  const wav = await piper.predict({ text, voiceId }); // Blob (audio/wav)
  return { blob: wav, ext: "wav" };
}

/* ---------- WEB SPEECH (giọng macOS) ---------- */
export function systemVoices() {
  const all = speechSynthesis.getVoices();
  const vi = all.filter((v) => /^vi/i.test(v.lang));
  return (vi.length ? vi : all).map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})`, _v: v }));
}
export function systemSpeak(text, voiceURI, rate = 1) {
  return new Promise((resolve, reject) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
    u.rate = rate; u.lang = v ? v.lang : "vi-VN";
    u.onend = resolve; u.onerror = (e) => reject(e.error || e);
    speechSynthesis.speak(u);
  });
}

/* ---------- EDGE-TTS (helper local hoặc Cloudflare Worker) ---------- */
export async function edgeAvailable() {
  try {
    const r = await fetch(`${getEdgeBase()}/health`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}
export async function edgeSynth(text, voiceId, rate = 1) {
  const pct = Math.round((rate - 1) * 100);
  const r = await fetch(`${getEdgeBase()}/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voiceId, rate: `${pct >= 0 ? "+" : ""}${pct}%` }),
  });
  if (!r.ok) throw new Error(`edge-tts lỗi ${r.status}: ${await r.text().catch(()=> "")}`);
  return { blob: await r.blob(), ext: "mp3" };
}
