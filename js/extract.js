// Trích xuất văn bản từ PDF / Markdown / TXT — chạy hoàn toàn trong trình duyệt.
import * as pdfjs from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

export async function extractText(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractPdf(file, onProgress);
  const raw = await file.text();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return stripMarkdown(raw);
  return raw;
}

async function extractPdf(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Gom theo dòng để giữ ngắt đoạn tương đối.
    let last = null, line = "";
    const lines = [];
    for (const it of content.items) {
      const y = it.transform[5];
      if (last !== null && Math.abs(y - last) > 3) { lines.push(line.trim()); line = ""; }
      line += it.str + (it.hasEOL ? "" : " ");
      last = y;
    }
    if (line.trim()) lines.push(line.trim());
    out.push(lines.join("\n"));
    onProgress(i / pdf.numPages);
  }
  return out.join("\n\n");
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")       // code blocks
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")   // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")// links -> text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-\*\+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
