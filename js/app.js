import { extractText } from "./extract.js";
import { hasWebGPU, gpuReady, getEngine, makeScript, requestPersistentStorage } from "./summarize.js";
import * as TTS from "./tts.js";
// (TTS.getEdgeBase / TTS.setEdgeBase dùng cho endpoint edge-tts tùy chỉnh)

const $ = (id) => document.getElementById(id);
const log = (m) => { const l = $("log"); l.textContent += (l.textContent ? "\n" : "") + m; };
let docText = "", lastAudioURL = null;

const isSafari = /^((?!chrome|android|crios|edg).)*safari/i.test(navigator.userAgent);

// Xin lưu trữ bền + hiện hạn mức, cảnh báo Safari.
(async () => {
  const info = await requestPersistentStorage();
  const h = $("storeHint");
  let msg = "";
  if (info) msg = `Dung lượng trình duyệt: còn ~${Math.max(0, info.quotaGB - info.usageGB).toFixed(1)}GB / ${info.quotaGB.toFixed(1)}GB.`;
  if (isSafari) msg += " ⚠ Safari giới hạn lưu trữ nhỏ — nên dùng Chrome cho model lớn, hoặc chọn model 0.5B.";
  if (h) h.textContent = msg;
})();

/* ---------- Theme ---------- */
$("themeBtn").onclick = () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("d2a-theme", next); } catch {}
};
try { const t = localStorage.getItem("d2a-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch {}

/* ---------- Offline badge ---------- */
function paintOnline() {
  const b = $("offlineBadge");
  if (navigator.onLine) { b.textContent = "● có mạng"; b.className = "badge on"; }
  else { b.textContent = "● offline — vẫn chạy được (nếu đã tải model)"; b.className = "badge off"; }
}
addEventListener("online", paintOnline); addEventListener("offline", paintOnline); paintOnline();

/* ---------- Input ---------- */
const drop = $("drop");
$("pickBtn").onclick = () => $("file").click();
drop.onclick = (e) => { if (e.target.tagName !== "BUTTON") $("file").click(); };
["dragover","dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$("file").onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); };
$("usePaste").onclick = () => {
  const t = $("pasteArea").value.trim();
  if (!t) return;
  docText = t; showSrc(`Văn bản đã dán · ${t.length.toLocaleString()} ký tự`); $("summBtn").disabled = false;
};

async function loadFile(file) {
  showSrc(`Đang đọc “${file.name}”…`);
  try {
    docText = await extractText(file, p => showSrc(`Đang đọc “${file.name}” — ${Math.round(p*100)}%`));
    if (!docText.trim()) { showSrc(`⚠ Không trích được chữ (PDF scan?). Hãy dán văn bản trực tiếp.`); return; }
    showSrc(`✓ “${file.name}” · ${docText.length.toLocaleString()} ký tự`);
    $("summBtn").disabled = false;
  } catch (e) { showSrc(`⚠ Lỗi đọc tệp: ${e.message}`); }
}
function showSrc(msg) { const s = $("srcInfo"); s.classList.remove("hidden"); s.textContent = msg; }

/* ---------- Progress helpers ---------- */
function prog(wrapId, pct, text) {
  const w = $(wrapId); w.classList.remove("hidden");
  w.querySelector(".bar").style.setProperty("--pct", Math.max(4, Math.round(pct*100)) + "%");
  w.querySelector(".ptext").textContent = text || "";
}
function progDone(wrapId) { setTimeout(() => $(wrapId).classList.add("hidden"), 600); }

/* ---------- Summarize ---------- */
const GPU_TIP = "Chrome chưa bật WebGPU nên không chạy được model tóm lược.\n\nCách bật: mở chrome://settings/system → bật “Use graphics acceleration when available” → Relaunch. Kiểm tra tại chrome://gpu (dòng WebGPU phải là Hardware accelerated). Dùng Chrome/Edge mới, không dùng Safari cũ.\n\nTrong lúc đó anh vẫn có thể TỰ DÁN hoặc sửa bản đọc ở ô bên dưới rồi bấm “Đọc thành audio” — giọng Piper không cần GPU.";

$("summBtn").onclick = async () => {
  if (!docText.trim()) return;
  if (!(await gpuReady())) {
    $("scriptWrap").classList.remove("hidden");
    $("script").value = $("script").value || docText; // mồi sẵn văn bản gốc để anh rút gọn tay
    $("ttsBtn").disabled = false;
    log("ℹ WebGPU chưa sẵn sàng — bỏ qua bước AI. Anh sửa/rút gọn bản đọc ở ô dưới rồi tạo audio (Piper không cần GPU).");
    alert(GPU_TIP);
    return;
  }
  $("summBtn").disabled = true;
  try {
    prog("summProgress", 0.02, "Khởi tạo model (lần đầu sẽ tải về, có thể vài trăm MB)…");
    const eng = await getEngine($("model").value, (p, t) => prog("summProgress", 0.02 + p*0.5, t));
    const script = await makeScript(
      docText,
      { style: $("style").value, length: $("length").value },
      eng,
      (t, p) => prog("summProgress", 0.55 + (p||0)*0.4, t)
    );
    $("scriptWrap").classList.remove("hidden");
    $("script").value = script;
    $("ttsBtn").disabled = false;
    prog("summProgress", 1, "Xong — anh có thể sửa bản đọc trước khi tạo audio.");
    log("✓ Đã tạo bản đọc.");
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/compatible gpu|webgpu|requestadapter|adapter/i.test(msg)) {
      $("scriptWrap").classList.remove("hidden");
      $("script").value = $("script").value || docText;
      $("ttsBtn").disabled = false;
      prog("summProgress", 1, "WebGPU chưa sẵn sàng — anh sửa bản đọc ở dưới rồi tạo audio.");
      log("⚠ WebGPU: " + msg);
      alert(GPU_TIP);
    } else if (/quota|exceeded|storage/i.test(msg)) {
      const tip = "Hết dung lượng lưu trữ của trình duyệt khi tải model. Cách xử lý: chọn model nhỏ hơn (0.5B hoặc 1.5B); dùng Chrome thay vì Safari; hoặc xóa dữ liệu site (DevTools → Application → Clear storage) rồi thử lại.";
      prog("summProgress", 1, tip);
      log("⚠ Quota: " + msg + "\n→ " + tip);
      alert(tip);
    } else {
      prog("summProgress", 1, "Lỗi: " + msg);
      log("⚠ " + msg);
    }
  } finally { $("summBtn").disabled = false; progDone("summProgress"); }
};

/* ---------- Engine / voice selectors ---------- */
const engineSel = $("engine");
engineSel.onchange = refreshVoices;
async function checkEdge() {
  const h = $("edgeHint"); h.classList.remove("hidden");
  h.textContent = "Đang kiểm tra endpoint…"; h.style.color = "var(--muted)";
  const ok = await TTS.edgeAvailable();
  const online = /^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(TTS.getEdgeBase());
  h.style.color = ok ? "var(--ok)" : "var(--warn)";
  h.textContent = ok
    ? (online ? "✓ Đã kết nối Worker edge-tts (online)." : "✓ Đã thấy helper edge-tts trên máy.")
    : (online ? "⚠ Không gọi được Worker — kiểm tra lại URL." : "⚠ Chưa có endpoint. Dán URL Cloudflare Worker, hoặc chạy: python3 edge_server.py");
}
async function refreshVoices() {
  const eng = engineSel.value, vsel = $("voice"); vsel.innerHTML = "";
  $("voiceWrap").classList.remove("hidden");
  $("edgeHint").classList.add("hidden");
  $("edgeUrlWrap").classList.add("hidden");
  if (eng === "piper") {
    TTS.PIPER_VOICES.forEach(v => vsel.add(new Option(v.label, v.id)));
  } else if (eng === "system") {
    const vs = TTS.systemVoices();
    if (!vs.length) vsel.add(new Option("(chưa thấy giọng — thử lại sau 1 giây)", ""));
    vs.forEach(v => vsel.add(new Option(v.label, v.id)));
  } else if (eng === "edge") {
    TTS.EDGE_VOICES.forEach(v => vsel.add(new Option(v.label, v.id)));
    $("edgeUrlWrap").classList.remove("hidden");
    const saved = TTS.getEdgeBase();
    $("edgeUrl").value = /workers\.dev|^https?:\/\/(?!127|localhost)/.test(saved) ? saved : "";
    await checkEdge();
  }
}
let edgeTimer;
$("edgeUrl").oninput = () => {
  TTS.setEdgeBase($("edgeUrl").value);
  clearTimeout(edgeTimer);
  edgeTimer = setTimeout(checkEdge, 600);
};
if (speechSynthesis.onvoiceschanged !== undefined)
  speechSynthesis.onvoiceschanged = () => { if (engineSel.value === "system") refreshVoices(); };
refreshVoices();

/* ---------- TTS ---------- */
$("ttsBtn").onclick = async () => {
  const text = $("script").value.trim();
  if (!text) { alert("Chưa có bản đọc."); return; }
  const engine = engineSel.value, voice = $("voice").value, rate = parseFloat($("rate").value);
  $("ttsBtn").disabled = true; $("player").classList.add("hidden");
  try {
    if (engine === "system") {
      prog("ttsProgress", 0.5, "Đang đọc bằng giọng hệ điều hành…");
      await TTS.systemSpeak(text, voice, rate);
      prog("ttsProgress", 1, "Đã đọc xong (giọng hệ điều hành không xuất file tải về).");
      log("ℹ Giọng macOS chỉ phát, không tạo file tải. Dùng Piper hoặc edge-tts nếu cần tải MP3/WAV.");
      return;
    }
    let out;
    if (engine === "piper") {
      out = await TTS.piperSynth(text, voice, (p, t) => prog("ttsProgress", p, t));
    } else {
      if (!(await TTS.edgeAvailable())) throw new Error("Chưa kết nối được edge-tts. Dán URL Cloudflare Worker vào ô endpoint, hoặc chạy helper: python3 edge_server.py");
      prog("ttsProgress", 0.4, "Đang gọi edge-tts…");
      out = await TTS.edgeSynth(text, voice, rate);
    }
    if (lastAudioURL) URL.revokeObjectURL(lastAudioURL);
    lastAudioURL = URL.createObjectURL(out.blob);
    const a = $("audio"); a.src = lastAudioURL; a.playbackRate = engine === "piper" ? rate : 1;
    const dl = $("download"); dl.href = lastAudioURL; dl.download = `ban-doc.${out.ext}`;
    $("player").classList.remove("hidden");
    prog("ttsProgress", 1, "Xong.");
    a.play().catch(()=>{});
    log("✓ Đã tạo audio (" + out.ext.toUpperCase() + ").");
  } catch (e) {
    prog("ttsProgress", 1, "Lỗi: " + e.message); log("⚠ " + e.message);
  } finally { $("ttsBtn").disabled = false; progDone("ttsProgress"); }
};

/* ---------- Service worker (offline app shell) ---------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
