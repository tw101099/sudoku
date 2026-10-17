const CACHE = "sudoku-v23";
const SHELL = [
  "./", "index.html", "style.css", "codec.js", "steps.js", "explain.js", "app.js", "egg.js", "manifest.webmanifest",
  "bank/1.txt", "bank/2.txt", "bank/3.txt", "bank/4.txt", "bank/5.txt", "bank/6.txt",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon.svg", "icons/favicon-32.png", "icons/seal.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req, { cache: "no-cache" })
        .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(() => cached);
      if (cached) { e.waitUntil(network.then(() => {}, () => {})); return cached; }
      return network;
    })
  );
});
