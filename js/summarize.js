// Tóm lược + biên tập thành "bản đọc" bằng LLM chạy trong trình duyệt (WebLLM / WebGPU).
import { MLCEngine, prebuiltAppConfig } from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let loadedModel = null;

export function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }

// Kiểm tra thật sự: có navigator.gpu VÀ xin được adapter (nhiều máy có gpu nhưng adapter null).
export async function gpuReady() {
  try {
    if (!navigator.gpu) return false;
    const a = await navigator.gpu.requestAdapter();
    return !!a;
  } catch { return false; }
}

// Xin trình duyệt cấp lưu trữ "bền" để giảm lỗi quota khi cache model.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
    if (navigator.storage?.estimate) {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      return { quotaGB: quota / 1e9, usageGB: usage / 1e9 };
    }
  } catch {}
  return null;
}

export async function getEngine(modelId, onProgress = () => {}) {
  if (engine && loadedModel === modelId) return engine;
  if (engine) { try { await engine.unload(); } catch (e) {} engine = null; loadedModel = null; }
  // useIndexedDBCache: hạn mức thường rộng hơn Cache API (đặc biệt trên Safari).
  const appConfig = { ...prebuiltAppConfig, useIndexedDBCache: true };
  const eng = new MLCEngine({
    appConfig,
    initProgressCallback: (r) => onProgress(r.progress ?? 0, r.text || "Đang tải model…"),
  });
  // reload() tường minh — chỉ gán engine sau khi model đã nạp xong, tránh lỗi "Model not loaded".
  await eng.reload(modelId);
  engine = eng;
  loadedModel = modelId;
  return engine;
}

const LEN = {
  short:  { words: "khoảng 150–250 từ",  note: "thật súc tích, chỉ giữ ý cốt lõi" },
  medium: { words: "khoảng 400–650 từ",  note: "đủ ý, dễ theo dõi" },
  long:   { words: "khoảng 800–1200 từ", note: "chi tiết, không bỏ sót phần quan trọng" },
};

const STYLE = {
  explain:  "Viết như một người am hiểu đang GIẢI THÍCH cho người nghe hiểu nội dung: mở đầu nêu ngay vấn đề/ý chính, rồi diễn giải từng phần bằng ngôn ngữ đời thường, có ví dụ khi cần, kết lại bằng điểm mấu chốt.",
  briefing: "Viết như một BẢN TIN / THÔNG BÁO đọc trên loa phát thanh: trang trọng, rõ ràng, câu ngắn, dẫn dắt mạch lạc từ bối cảnh đến nội dung đến đề nghị/kết luận.",
  bullets:  "Trình bày thành các Ý CHÍNH tuần tự, mỗi ý một câu hoặc một đoạn ngắn, nói rõ 'Thứ nhất', 'Thứ hai'… để người nghe dễ bám theo.",
};

function chunk(text, size = 6000) {
  const parts = [];
  const paras = text.split(/\n\s*\n/);
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { parts.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function ask(eng, system, user, max_tokens = 1500, onTok) {
  const req = {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.4, max_tokens,
  };
  try {
    const res = await eng.chat.completions.create(req);
    return res.choices[0].message.content.trim();
  } catch (e) {
    // Nếu model bị "rớt" (not loaded), nạp lại rồi thử lần nữa.
    if (/not loaded|reload/i.test(String(e && e.message || e)) && loadedModel) {
      await eng.reload(loadedModel);
      const res = await eng.chat.completions.create(req);
      return res.choices[0].message.content.trim();
    }
    throw e;
  }
}

// Trả về bản đọc tiếng Việt, sẵn sàng cho TTS.
export async function makeScript(text, { style = "explain", length = "medium" }, eng, onStatus = () => {}) {
  const L = LEN[length] || LEN.medium;
  const S = STYLE[style] || STYLE.explain;
  const chunks = chunk(text);
  let digest = text;

  if (chunks.length > 1) {
    const partials = [];
    for (let i = 0; i < chunks.length; i++) {
      onStatus(`Đang đọc phần ${i + 1}/${chunks.length}…`, i / chunks.length);
      const sys = "Bạn là trợ lý tóm tắt tài liệu. BẮT BUỘC viết hoàn toàn bằng TIẾNG VIỆT, tuyệt đối không dịch sang tiếng Anh. Chỉ trả về nội dung tóm tắt, không thêm lời dẫn.";
      const u = `Tóm tắt phần tài liệu sau thành các ý chính bằng tiếng Việt, giữ nguyên số liệu và thuật ngữ quan trọng:\n\n${chunks[i]}`;
      partials.push(await ask(eng, sys, u, 900));
    }
    digest = partials.join("\n\n");
  }

  onStatus("Đang biên tập bản đọc…", 0.9);
  const sys = `Bạn là biên tập viên tạo kịch bản đọc tiếng Việt tự nhiên để chuyển thành giọng nói.
QUAN TRỌNG NHẤT: Viết TOÀN BỘ bằng TIẾNG VIỆT. Tuyệt đối KHÔNG dịch, KHÔNG viết bằng tiếng Anh. Dù tài liệu gốc có đoạn tiếng Anh, bản đọc vẫn phải là tiếng Việt (chỉ giữ nguyên tên riêng hoặc thuật ngữ không có từ tiếng Việt tương đương).
${S}
Yêu cầu:
- Độ dài ${L.words}, ${L.note}.
- Viết văn xuôi liền mạch, KHÔNG dùng dấu đầu dòng, markdown, emoji, tiêu đề, hay ký hiệu đặc biệt.
- Viết số bằng chữ khi hợp lý để máy đọc đúng (ví dụ: "hai mươi bốn trên hai mươi bốn giờ"). Số điện thoại tách từng cụm.
- Chỉ trả về bản đọc tiếng Việt, không thêm lời giải thích nào khác.`;
  const user = `Viết bản đọc hoàn chỉnh BẰNG TIẾNG VIỆT dựa trên nội dung sau:\n\n${digest}`;
  return clean(await ask(eng, sys, user, 2200));
}

function clean(s) {
  return s
    .replace(/[#*_`>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
