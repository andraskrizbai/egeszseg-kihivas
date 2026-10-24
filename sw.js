/* Egészség kihívás service worker: cache-first, verziózott gyorsítótár.
   Ütemezett értesítést zárt appban nem tud küldeni (nincs push szerver);
   a notificationclick csak a már megjelenített jelzést nyitja meg. */
var CACHE = "egeszseg-kihivas-v2";
var ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];
function sameScope(url) {
  return url.indexOf(self.registration.scope) === 0;
}
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("egeszseg-kihivas-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* pl. Open Food Facts: mindig hálózat */
  if (!sameScope(url.href)) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = new URL("./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      if (sameScope(cs[i].url) && "focus" in cs[i]) return cs[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
