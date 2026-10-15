// Service worker: cache app shell + thư viện CDN để chạy offline sau lần tải đầu.
// (Model LLM và giọng Piper tự cache riêng qua Cache API / IndexedDB của thư viện.)
const SHELL = "d2a-shell-v3";
const RUNTIME = "d2a-runtime-v3";
const APP = [
  "./", "./index.html", "./css/style.css",
  "./js/app.js", "./js/extract.js", "./js/summarize.js", "./js/tts.js",
];

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
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Không can thiệp helper edge-tts (localhost:5005) và các POST.
  if (url.port === "5005") return;

  // App shell: cache-first.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }
  // CDN (pdf.js, web-llm, vits-web, model shards): cache-first, nền tảng offline.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
