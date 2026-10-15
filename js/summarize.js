// Tóm lược + biên tập thành "bản đọc" bằng LLM chạy trong trình duyệt (WebLLM / WebGPU).
import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let loadedModel = null;

export function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }

export async function getEngine(modelId, onProgress = () => {}) {
  if (engine && loadedModel === modelId) return engine;
  if (engine) { try { await engine.unload(); } catch (e) {} engine = null; }
  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress(r.progress ?? 0, r.text || "Đang tải model…"),
  });
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
  const res = await eng.chat.completions.create({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.4, max_tokens,
  });
  return res.choices[0].message.content.trim();
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
      const sys = "Bạn là trợ lý tóm tắt tài liệu tiếng Việt. Chỉ trả về nội dung tóm tắt, không thêm lời dẫn.";
      const u = `Tóm tắt phần tài liệu sau thành các ý chính, giữ nguyên số liệu và thuật ngữ quan trọng:\n\n${chunks[i]}`;
      partials.push(await ask(eng, sys, u, 900));
    }
    digest = partials.join("\n\n");
  }

  onStatus("Đang biên tập bản đọc…", 0.9);
  const sys = `Bạn là biên tập viên tạo kịch bản đọc tiếng Việt tự nhiên để chuyển thành giọng nói.
${S}
Yêu cầu:
- Độ dài ${L.words}, ${L.note}.
- Viết văn xuôi liền mạch, KHÔNG dùng dấu đầu dòng, markdown, emoji, tiêu đề, hay ký hiệu đặc biệt.
- Viết số bằng chữ khi hợp lý để máy đọc đúng (ví dụ: "hai mươi bốn trên hai mươi bốn giờ"). Số điện thoại tách từng cụm.
- Giữ nguyên thuật ngữ tiếng Anh nếu có.
- Chỉ trả về bản đọc, không thêm lời giải thích nào khác.`;
  const user = `Dựa trên nội dung sau, hãy viết bản đọc hoàn chỉnh:\n\n${digest}`;
  return clean(await ask(eng, sys, user, 2200));
}

function clean(s) {
  return s
    .replace(/[#*_`>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
