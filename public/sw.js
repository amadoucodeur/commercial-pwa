const VERSION = "v2";
const PAGES = `pages-${VERSION}`;
const STATIQUES = `statiques-${VERSION}`;
const DELAI_RESEAU = 6000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const noms = await caches.keys();
  await Promise.all(noms.filter((nom) => nom !== PAGES && nom !== STATIQUES).map((nom) => caches.delete(nom)));
  await self.clients.claim();
})()));

const statique = (url) => url.origin === self.location.origin && (
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image") ||
  /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname));

async function mettreEnCachePage(requete, reponse) {
  // Ne jamais conserver une redirection (session expirée) à la place de l'application.
  if (!reponse.ok || reponse.redirected || reponse.type !== "basic") return;
  const cache = await caches.open(PAGES);
  await cache.put(new URL(requete.url).pathname, reponse);
}

async function page(requete) {
  const reseau = fetch(requete).then((reponse) => {
    void mettreEnCachePage(requete, reponse.clone());
    return reponse;
  });
  const cache = await caches.open(PAGES);
  const enCache = () => cache.match(new URL(requete.url).pathname).then((reponse) => reponse ?? cache.match("/"));
  try {
    return await Promise.race([
      reseau,
      new Promise((_, reject) => setTimeout(() => reject(new Error("délai")), DELAI_RESEAU)),
    ]);
  } catch {
    const reponse = await enCache();
    if (reponse) return reponse;
    try { return await reseau; } catch {
      return new Response("<meta charset=utf-8><meta name=viewport content='width=device-width'><p style='font-family:sans-serif;padding:24px'>Hors connexion. Ouvrez l’application une première fois avec du réseau pour l’utiliser ensuite hors ligne.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }
}

async function ressource(requete) {
  const cache = await caches.open(STATIQUES);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;
  const reponse = await fetch(requete);
  if (reponse.ok) void cache.put(requete, reponse.clone());
  return reponse;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") event.respondWith(page(event.request));
  else if (statique(url)) event.respondWith(ressource(event.request));
});

self.addEventListener("message", (event) => {
  const { type, urls } = event.data ?? {};
  if (type === "precharger" && Array.isArray(urls)) {
    event.waitUntil((async () => {
      for (const adresse of urls) {
        try {
          const url = new URL(adresse, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          if (statique(url)) { await ressource(new Request(url)); continue; }
          const reponse = await fetch(url, { credentials: "same-origin" });
          await mettreEnCachePage(new Request(url), reponse);
        } catch { /* sera mis en cache à la prochaine visite */ }
      }
    })());
  }
  if (type === "vider") event.waitUntil(caches.delete(PAGES));
});
