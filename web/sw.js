/* Kalos Workout: guarda solo el "cascarón" de la app. Los datos siempre van frescos a la red. */
const V = 'kalos-app-v8';
const CASCARON = ['./', './index.html', './manifest.webmanifest', './config.js', './logo.png', './isotipo-splash.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CASCARON)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== 'kalos-cfg').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;          // Apps Script y otros: siempre a la red, sin guardar
  if (r.mode === 'navigate') {                        // la página: red primero (siempre la última versión), caché si no hay internet
    e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(V).then((c) => c.put('./index.html', cp)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r)));
});

/* ---------- avisos (notificaciones) ----------
   El servidor manda un push SIN texto. Al llegar, la app pide el mensaje del momento y lo muestra. */
async function leerCfg() {
  try { const c = await caches.open('kalos-cfg'); const r = await c.match(self.registration.scope + 'cfg-push'); return r ? await r.json() : null; } catch (e) { return null; }
}
async function mostrarAviso() {
  let t = '🦍 Kalos', x = 'Tienes un aviso en tu tarjeta.', u = './?app=1';
  const cfg = await leerCfg();
  if (cfg && cfg.api && cfg.id && cfg.endpoint) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(cfg.api, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal,
        body: JSON.stringify({ accion: 'push_mensaje', id: cfg.id, endpoint: cfg.endpoint }) });
      clearTimeout(to);
      const d = await r.json();
      if (d && d.ok) { t = d.titulo || t; x = d.texto || x; u = d.url || u; }
    } catch (e) {}
  }
  return self.registration.showNotification(t, { body: x, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'kalos-aviso', renotify: true, data: { url: u } });
}
self.addEventListener('push', (e) => { e.waitUntil(mostrarAviso()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './?app=1', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) {
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.navigate(url).then((x) => (x || c).focus()).catch(() => c.focus());
    }
    return self.clients.openWindow(url);
  }));
});
