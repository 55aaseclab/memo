const CACHE = "memo-v0.5.9";
const ASSETS = ["./", "./index.html", "./records-client.js"];
const shellURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("message", e => { if(e.data==="update") self.registration.update().catch(()=>{}) });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("memo-v") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !shellURLs.has(req.url)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type !== "opaqueredirect" && !res.redirected) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.open(CACHE).then(c => c.match(req)).then(r => r || caches.match(new URL("./index.html", self.registration.scope).href)))
  );
});
