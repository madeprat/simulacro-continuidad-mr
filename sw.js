// Service worker: precarga el motor y los packs para ejecutar el simulacro sin conexión.
// Estrategia: red primero (para recibir cambios del pack) y caché como respaldo offline. Si la red tarda más de
// 3 s (wifi de sala con portal cautivo o sin salida), se sirve la caché y la respuesta de red la actualiza al llegar.
const CACHE = 'simulacro-mr-v11';
const NET_TIMEOUT_MS = 3000;
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/panel.js',
  'js/pack.js',
  'js/session.js',
  'js/copilot-view.js',
  'js/crisis-panel.js',
  'js/voice.js',
  'js/sync.js',
  'js/layout.js',
  'js/command-bar.js',
  'js/shared-state.js',
  'js/integrity.js',
  'js/csv.js',
  'js/site-model.js',
  'js/site-view.js',
  'vendor/peerjs.min.js',
  'copiloto/',
  'copiloto/index.html',
  'copiloto/catalogo.html',
  'copiloto/css/copiloto.css',
  'copiloto/css/pagina.css',
  'copiloto/js/main.js',
  'copiloto/js/copiloto.js',
  'copiloto/js/core.js',
  'copiloto/js/clock.js',
  'copiloto/js/backend.js',
  'copiloto/js/data.js',
  'copiloto/js/ejercicio.js',
  'copiloto/data/config.json',
  'copiloto/data/servicios.json',
  'copiloto/data/escenarios.json',
  'copiloto/data/estrategias.json',
  'copiloto/docs/doc.css',
  'copiloto/docs/plan-gestion-incidentes.html',
  'copiloto/docs/estrategia-recuperacion.html',
  'copiloto/docs/directorio-equipo.html',
  'debrief/',
  'debrief/index.html',
  'debrief/main.js',
  'debrief/consolidar.js',
  'debrief/debrief.css',
  'vendor/three.module.min.js',
  'manifest.webmanifest',
  'packs/index.json',
  'packs/tramontana/manifest.json',
  'packs/tramontana/roles.json',
  'packs/tramontana/rounds.json',
  'packs/tramontana/debrief.json',
  'packs/tramontana/site.json',
  'packs/gregal/manifest.json',
  'packs/gregal/roles.json',
  'packs/gregal/rounds.json',
  'packs/gregal/debrief.json',
  'packs/gregal/site.json',
  'packs/altamar/manifest.json',
  'packs/altamar/roles.json',
  'packs/altamar/rounds.json',
  'packs/altamar/debrief.json',
  'packs/altamar/site.json',
  'packs/altamar/catalogo/config.json',
  'packs/altamar/catalogo/servicios.json',
  'packs/altamar/catalogo/escenarios.json',
  'packs/altamar/catalogo/estrategias.json',
  'packs/altamar/catalogo/comunicaciones.json',
  'packs/valdecierzo/manifest.json',
  'packs/valdecierzo/roles.json',
  'packs/valdecierzo/rounds.json',
  'packs/valdecierzo/debrief.json',
  'packs/valdecierzo/site.json',
  'packs/valdecierzo/catalogo/config.json',
  'packs/valdecierzo/catalogo/servicios.json',
  'packs/valdecierzo/catalogo/escenarios.json',
  'packs/valdecierzo/catalogo/estrategias.json',
  'packs/valdecierzo/catalogo/comunicaciones.json',
  'packs/sierraclara/manifest.json',
  'packs/sierraclara/roles.json',
  'packs/sierraclara/rounds.json',
  'packs/sierraclara/debrief.json',
  'packs/sierraclara/site.json',
  'packs/sierraclara/catalogo/config.json',
  'packs/sierraclara/catalogo/servicios.json',
  'packs/sierraclara/catalogo/escenarios.json',
  'packs/sierraclara/catalogo/estrategias.json',
  'packs/sierraclara/catalogo/comunicaciones.json',
  'packs/siroco/manifest.json',
  'packs/siroco/roles.json',
  'packs/siroco/rounds.json',
  'packs/siroco/debrief.json',
  'packs/siroco/site.json',
  'packs/siroco/catalogo/config.json',
  'packs/siroco/catalogo/servicios.json',
  'packs/siroco/catalogo/escenarios.json',
  'packs/siroco/catalogo/estrategias.json',
  'packs/siroco/catalogo/comunicaciones.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const network = fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  e.respondWith((async () => {
    const timeout = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT_MS, 'timeout'));
    const first = await Promise.race([network.catch(() => 'error'), timeout]);
    if (first !== 'timeout' && first !== 'error') return first;
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    return network; // sin copia en caché: se espera a la red (o falla como sin service worker)
  })());
});
