// Service worker v5: CHỈ cache app shell + vài thư viện JS nhỏ cho offline.
// KHÔNG cache model (shard từ huggingface) — WebLLM/Piper tự cache trong IndexedDB.
// Mọi cache.put đều bọc try/catch để không bao giờ ném QuotaExceededError.
const SHELL = "d2a-shell-v7";
const RUNTIME = "d2a-runtime-v7";
const APP = [
  "./", "./index.html", "./css/style.css",
  "./js/app.js", "./js/extract.js", "./js/summarize.js", "./js/tts.js",
];
// Chỉ cache thư viện JS/CSS/WASM nhỏ từ các CDN này (KHÔNG gồm huggingface).
const LIB_HOSTS = ["esm.run", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function safePut(req, res) {
  try { (await caches.open(RUNTIME)).put(req, res); } catch (e) { /* quota — bỏ qua */ }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Bỏ qua hoàn toàn: helper edge-tts, request Range (shard model), và model host.
  if (url.port === "5005") return;
  if (req.headers.has("range")) return;
  if (/huggingface\.co|hf\.co|cdn-lfs|raw\.githubusercontent\.com/.test(url.host)) return;

  // App shell (same-origin): cache-first.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // Chỉ cache thư viện nhỏ từ CDN cho phép; còn lại fetch thẳng, không cache.
  const isLib = LIB_HOSTS.some((h) => url.host.endsWith(h));
  if (!isLib) return; // để trình duyệt tự xử lý (model, v.v.)

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) safePut(req, res.clone());
        return res;
      });
    })
  );
});
