// Barra de ejercicio del copiloto: reloj simulado, estado de ronda del pack, reinicio y catálogo desde Google Sheets.
import { exerciseBase, roundCopilotState } from './core.js';
import { getSheetUrls, importFromSheets, clearImported } from './data.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

const fmtClock = (ms) => new Date(ms).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function mountExerciseBar({ clock, backend, dataset, open = false }) {
  const status = h('p', { class: 'ej-status', role: 'status' });
  const say = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };

  // Reloj
  const clockText = h('strong', { class: 'ej-clock' });
  const modeText = h('span', { class: 'ej-mode' });
  const pauseBtn = h('button', { type: 'button', onclick: () => (clock.paused ? clock.resume() : clock.pause()) });
  const speedSel = h('select', { 'aria-label': 'Velocidad del reloj', onchange: (e) => clock.setSpeed(parseFloat(e.target.value)) },
    [1, 10, 60, 360].map((s) => h('option', { value: s }, `×${s}`)));
  const refresh = () => {
    clockText.textContent = fmtClock(clock.now());
    modeText.textContent = clock.mode === 'real' ? 'Hora real' : clock.paused ? 'Simulada · en pausa' : `Simulada · ×${clock.speed}`;
    pauseBtn.textContent = clock.paused ? '▶ Reanudar' : '⏸ Pausar';
    speedSel.value = String(clock.speed);
  };
  setInterval(refresh, 500);
  clock.onChange(refresh);
  const jump = (label, ms) => h('button', { type: 'button', onclick: () => clock.advance(ms) }, label);

  // Rondas del pack
  const packSel = h('select', { 'aria-label': 'Pack de ejercicio' });
  const roundSel = h('select', { 'aria-label': 'Ronda' });
  let rounds = [];
  const loadRounds = async () => {
    roundSel.replaceChildren();
    try {
      const base = new URL(packSel.value, new URL('../', location.href));
      const manifest = await (await fetch(new URL('manifest.json', base))).json();
      const file = (manifest.files && manifest.files.rounds) || 'rounds.json';
      rounds = ((await (await fetch(new URL(file, base))).json()).rounds || []).filter((r) => r.copilot);
      for (const r of rounds) roundSel.append(h('option', { value: r.id }, `Ronda ${r.number} · ${r.crisis_time} · ${r.title}`));
    } catch (e) {
      say('No se pudo leer el pack: ' + e.message, 'error');
    }
  };
  (async () => {
    try {
      const idx = await (await fetch('../packs/index.json')).json();
      for (const p of idx.packs) packSel.append(h('option', { value: p.path }, p.label));
      await loadRounds();
    } catch {
      say('No hay packs disponibles junto al copiloto.', 'warn');
    }
  })();
  packSel.addEventListener('change', loadRounds);
  const applyRound = () => {
    const round = rounds.find((r) => r.id === roundSel.value);
    const st = roundCopilotState(round, exerciseBase());
    if (!st) return;
    clock.set(st.nowMs);
    backend.applyExerciseState({ scenarios: st.selected, createdMs: st.createdMs, onsetMs: st.onsetMs, status: st.status });
    location.reload();
  };

  // Catálogo desde Google Sheets
  const urls = getSheetUrls(dataset.config);
  const urlInput = (key, label) => h('label', { class: 'ej-field' }, h('span', {}, label),
    h('input', { type: 'url', value: urls[key] || '', placeholder: 'https://docs.google.com/…/pub?output=csv', 'data-key': key }));
  const sheetFields = [urlInput('servicios', 'Servicios'), urlInput('escenarios', 'Escenarios'), urlInput('estrategias', 'Estrategias')];
  const importSheets = async () => {
    const next = {};
    for (const f of sheetFields) { const i = f.querySelector('input'); next[i.dataset.key] = i.value.trim(); }
    if (Object.values(next).some((v) => !v)) { say('Indica las tres URL publicadas como CSV.', 'warn'); return; }
    say('Descargando hojas…');
    try {
      const r = await importFromSheets(next);
      say(`Importados ${r.services} servicios y ${r.scenarios} escenarios. Recargando…`, 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      say('No se pudo importar: ' + e.message, 'error');
    }
  };

  const panel = h('section', { class: 'ej-panel', hidden: !open, 'aria-label': 'Modo ejercicio' },
    h('header', { class: 'ej-head' }, h('b', {}, 'Modo ejercicio'), h('button', { type: 'button', class: 'ej-x', 'aria-label': 'Cerrar', onclick: () => { panel.hidden = true; } }, '✕')),
    h('div', { class: 'ej-block' }, h('span', { class: 'ej-label' }, 'Reloj del copiloto'), clockText, modeText,
      h('div', { class: 'ej-row' }, jump('+5 min', 300000), jump('+15 min', 900000), jump('+1 h', 3600000), jump('+1 día', 86400000)),
      h('div', { class: 'ej-row' }, pauseBtn, speedSel, h('button', { type: 'button', onclick: () => clock.real() }, 'Hora real'))),
    h('div', { class: 'ej-block' }, h('span', { class: 'ej-label' }, 'Estado de ronda del pack'), packSel, roundSel,
      h('div', { class: 'ej-row' },
        h('button', { type: 'button', class: 'ej-primary', onclick: applyRound }, 'Aplicar ronda'),
        h('button', { type: 'button', onclick: () => { if (confirm('¿Borrar el incidente y el historial de este navegador?')) { backend.reset(); location.reload(); } } }, 'Reiniciar incidente'))),
    h('details', { class: 'ej-block' }, h('summary', {}, 'Catálogo desde Google Sheets'),
      h('p', { class: 'ej-hint' }, 'Archivo → Compartir → Publicar en la web → cada hoja como CSV. Las plantillas están en copiloto/data/plantilla/.'),
      sheetFields,
      h('div', { class: 'ej-row' },
        h('button', { type: 'button', class: 'ej-primary', onclick: importSheets }, 'Importar'),
        h('button', { type: 'button', onclick: () => { clearImported(); location.reload(); } }, 'Usar catálogo incluido'))),
    h('p', { class: 'ej-source' }, 'Catálogo: ' + dataset.source),
    status,
  );
  const toggle = h('button', { type: 'button', class: 'ej-toggle', onclick: () => { panel.hidden = !panel.hidden; } }, '🎬 Ejercicio');
  document.body.append(toggle, panel);
  refresh();
}
