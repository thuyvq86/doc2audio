# 🎧 Doc2Audio

Nạp **PDF / Markdown / văn bản** → AI **tóm lược & biên tập thành bản đọc dễ hiểu** → **đọc thành audio**.
Mọi thứ chạy **ngay trong trình duyệt**, không gửi dữ liệu lên server. Hoạt động **offline** sau lần tải đầu.

> Không phải "text-to-speech thuần" đọc nguyên văn — công cụ *viết lại* nội dung thành bản đọc giải thích rồi mới tạo giọng, để người nghe hiểu được tài liệu.

## Tính năng

- **Đầu vào:** PDF (rút chữ bằng pdf.js), Markdown, TXT, hoặc dán trực tiếp.
- **Tóm lược offline:** model chạy trong máy qua [WebLLM](https://github.com/mlc-ai/web-llm) (WebGPU) — Qwen2.5 3B/1.5B/0.5B, Llama 3.2 1B.
- **Bản đọc sửa được:** AI tạo nháp, bạn chỉnh tay trước khi tạo audio.
- **Ba giọng đọc:**
  1. **Piper** — offline hoàn toàn, chạy bằng WASM trong trình duyệt ([vits-web](https://github.com/diffusionstudio/vits-web)).
  2. **Giọng hệ điều hành** (Web Speech API) — nhanh, có sẵn trên macOS (chỉ phát, không xuất file).
  3. **edge-tts** — giọng tự nhiên nhất; cần chạy kèm helper `edge_server.py` (xuất MP3 tải về).
- **Tải audio** về dạng WAV (Piper) hoặc MP3 (edge-tts).

## Dùng nhanh (bản online — GitHub Pages)

Mở: `https://thuyvq86.github.io/doc2audio/`

- Cần **Chrome hoặc Edge** mới (hỗ trợ WebGPU), hoặc Safari 18+.
- **Lần đầu** cần internet để tải model (vài trăm MB → ~2GB tùy model) và giọng Piper (~60MB). Sau đó dùng offline được.

## Dùng offline trên máy (khuyến nghị cho tài liệu nội bộ)

```bash
git clone https://github.com/thuyvq86/doc2audio.git
cd doc2audio
python3 -m http.server 8000
# mở http://localhost:8000
```

Chạy lần đầu có mạng để model tự tải & cache; các lần sau rút mạng vẫn chạy.

## Bật giọng edge-tts (tùy chọn — giọng hay nhất)

edge-tts không chạy được trong trang web tĩnh (nó gọi dịch vụ Microsoft qua Python), nên đi kèm một helper nhỏ:

```bash
pip3 install --user edge-tts
python3 edge_server.py        # chạy tại http://127.0.0.1:5005
```

Giữ cửa sổ đó mở, rồi trong web tool chọn giọng **edge-tts**. Dừng bằng `Ctrl+C`.

## Model & giọng

| Thành phần | Mặc định | Ghi chú |
|---|---|---|
| Tóm lược | `Qwen2.5-3B-Instruct` | tiếng Việt tốt; 0.5B/1.5B nhẹ hơn cho máy yếu |
| Giọng offline | `vi_VN-vais1000-medium` (Piper) | nam, rõ |
| Giọng tự nhiên | `vi-VN-NamMinhNeural` / `HoaiMyNeural` (edge-tts) | cần helper |

## Yêu cầu

- Trình duyệt có **WebGPU** cho phần tóm lược (Chrome/Edge 113+, Safari 18+).
- Phần đọc Piper chỉ cần WASM (không cần WebGPU).
- Máy khuyến nghị ≥ 8GB RAM cho model 1.5B, ≥ 16GB cho 3B.

## Quyền riêng tư

Tài liệu được xử lý **cục bộ trong trình duyệt**. Không có backend. Chỉ khi bật giọng edge-tts thì phần *văn bản bản đọc* mới được gửi tới dịch vụ đọc của Microsoft (qua helper trên máy bạn).

## Giấy phép

MIT — xem [LICENSE](LICENSE).
