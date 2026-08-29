/**
 * A deliberately small service worker.
 *
 * Its job is to make the app installable and to survive a dropped connection, not to
 * cache aggressively: this app's whole point is live on-chain data, and a stale
 * price served from a cache would be worse than no price. So indexer and RPC traffic
 * is never touched, and the shell is served network-first with the cache as a
 * fallback rather than cache-first.
 */
const CACHE = "kurvv-shell-v1";
const SHELL = ["/play", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept live data or anything off-origin.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/play"))),
  );
});
