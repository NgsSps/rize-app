/* RIZE — Service Worker
   Stratégie :
   - index.html        → network-first (toujours à jour, même sur iOS), copie en cache pour le hors ligne
   - assets statiques  → cache-first (icônes, manifest) + polices Google (pour le hors ligne)
   - TOUT LE RESTE     → réseau direct, jamais mis en cache : Supabase (synchro, messages, tableau de bord),
                         requêtes POST/RPC, etc. (sinon les données restaient figées sur la 1re réponse reçue)
   Le nom du cache reste stable → pas de re-installation requise
*/
const CACHE       = 'rize-app-v2';      // NE PAS CHANGER ce nom
const STATIC      = [
  '/rize-app/manifest.json',
  '/rize-app/icon-192.png',
  '/rize-app/icon-512.png',
];
const FONT_HOSTS  = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* Ce qui a le droit de vivre dans le cache */
function cacheable(urlStr) {
  const u = new URL(urlStr);
  if (FONT_HOSTS.indexOf(u.hostname) >= 0) return true;
  if (u.origin !== self.location.origin) return false;
  return u.pathname === '/rize-app/' || u.pathname === '/rize-app/index.html' || STATIC.indexOf(u.pathname) >= 0;
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => caches.open(CACHE)).then(c =>
      // Nettoyage : les anciennes versions de ce fichier avaient gardé en cache des réponses Supabase périmées
      c.keys().then(reqs => Promise.all(reqs.filter(r => !cacheable(r.url)).map(r => c.delete(r))))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST / RPC : on ne touche à rien
  if (!cacheable(req.url)) return;                  // Supabase et tout le reste : réseau direct

  const url = new URL(req.url);

  // index.html → network-first : toujours chercher la dernière version
  if (url.origin === self.location.origin && (url.pathname === '/rize-app/' || url.pathname === '/rize-app/index.html')) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))   // offline fallback
    );
    return;
  }

  // Assets statiques + polices → cache-first
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return resp;
      });
    })
  );
});
