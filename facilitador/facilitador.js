// Consola del facilitador: entra en la sala de sincronización de los visores con el rol FAC, ve dónde está cada
// visor y qué decide, y lanza las órdenes del ejercicio (comenzar, rondas, injects, pausa, avisos).
// No guarda evidencias propias: cada visor registra en su sesión las órdenes que recibe (facilitator_command).
import { loadPack, assessmentFor } from '../js/pack.js';
import { SyncHub, syncLabel } from '../js/sync.js';
import { newSessionId } from '../js/session.js';
import { FACILITATOR_ROLE, controlMessage, peerName } from '../js/facilitator.js';

const $ = (id) => document.getElementById(id);
const STORE = 'simulacro:facilitador';
const TYPE_LABEL = { PHONE: '📞 Llamada', DOCUMENT: '📄 Documento', MESSAGE: '✉️ Mensaje', MEDIA: '🎞 Media', ALERT: '⚠️ Alerta', INFO_CARD: 'ℹ️ Información' };
// Actuaciones del Panel de Crisis que interesan al facilitador (el resto son selecciones intermedias o el estado de
// referencia de cada ronda).
const PANEL_ACTION = {
  analyze: 'analiza el impacto en el Panel de Crisis', onset: 'fija el inicio real del incidente',
  contain: 'pausa el seguimiento del incidente', resume: 'reanuda el seguimiento del incidente',
  close: 'cierra el incidente', sent: 'marca una comunicación como notificada', convene: 'convoca al comité',
};

const F = {
  pack: null, packPath: null, sessionId: null, hub: null,
  answers: {}, // decision_id → { answer, from, at }
  startedAt: null, pausedAt: null, pausedMs: 0, currentRound: null,
};

const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const hhmmss = (d = new Date()) => d.toTimeString().slice(0, 8);

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

function remember() {
  try { localStorage.setItem(STORE, JSON.stringify({ pack: F.packPath, session: F.sessionId })); } catch { /* sin almacenamiento */ }
}

function recall() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}

/* ─────────────── Preparación ─────────────── */

async function initSetup() {
  const last = recall();
  $('session-id').value = last.session || newSessionId();
  const sel = $('pack-select');
  try {
    const res = await fetch('../packs/index.json', { cache: 'no-cache' });
    const idx = await res.json();
    for (const p of idx.packs) {
      const o = el('option', p.label);
      o.value = '../' + p.path;
      sel.appendChild(o);
    }
  } catch (e) {
    $('pack-status').textContent = 'No se pudo leer el catálogo de packs: ' + e.message;
    return;
  }
  if (last.pack && [...sel.options].some((o) => o.value === last.pack)) sel.value = last.pack;
  sel.addEventListener('change', () => selectPack(sel.value));
  await selectPack(sel.value);

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!F.pack || F.pack.errors.length) return;
    const code = $('session-id').value.trim();
    if (!code) { $('setup-error').textContent = 'Escribe el código de sesión.'; return; }
    F.sessionId = code;
    remember();
    openConsole();
  });
}

async function selectPack(path) {
  $('pack-status').textContent = 'Cargando pack…';
  try {
    F.pack = await loadPack(path);
    F.packPath = path;
  } catch (e) {
    F.pack = null;
    $('pack-status').textContent = 'Error al cargar el pack: ' + e.message;
    $('btn-open').disabled = true;
    return;
  }
  const m = F.pack.manifest;
  $('pack-status').textContent = F.pack.errors.length
    ? `El pack ${m.exercise_id} tiene errores: ${F.pack.errors[0]}`
    : `✓ ${m.name} · v${m.version} · ${F.pack.rounds.length} rondas · ${F.pack.decisionCount} decisiones · ${m.duration_minutes} min`;
  $('btn-open').disabled = !!F.pack.errors.length;
}

/* ─────────────── Sala ─────────────── */

function openConsole() {
  const m = F.pack.manifest;
  F.answers = {};
  F.startedAt = null; F.pausedAt = null; F.pausedMs = 0; F.currentRound = null;
  $('c-pack').textContent = `${m.name} · v${m.version}`;
  $('c-session').textContent = F.sessionId;
  $('c-feed').replaceChildren();
  const to = $('msg-to');
  to.replaceChildren(el('option', 'Todos los visores'));
  to.options[0].value = 'ALL';
  for (const r of F.pack.roles) { const o = el('option', r.name); o.value = r.id; to.appendChild(o); }
  renderScript();
  renderPeers();
  renderState();
  show('screen-console');

  const transport = new URLSearchParams(location.search).get('sync') === 'local' ? 'local' : 'peer';
  // Misma sala que los visores: identificador del ejercicio + código de sesión.
  F.hub = new SyncHub({ room: `${m.exercise_id}-${F.sessionId}`, role: FACILITATOR_ROLE, transport });
  F.hub.addEventListener('status', () => { $('c-sync').textContent = syncLabel(F.hub); });
  F.hub.addEventListener('peers', () => { $('c-sync').textContent = syncLabel(F.hub); renderPeers(); });
  F.hub.addEventListener('join', (e) => feed(`${peerName(e.detail.role)} entra en la sala`));
  F.hub.addEventListener('message', (e) => onMessage(e.detail));
  F.hub.start();
  F.hub.setPresence({ step: null, label: 'consola' });
  feed('Sala abierta. Esperando a los visores…');
}

function closeConsole() {
  if (F.hub) F.hub.stop();
  F.hub = null;
  show('screen-setup');
}

function onMessage(msg) {
  const { type, from, data } = msg;
  if (type === 'answer') {
    const prev = F.answers[data.decision_id];
    if (prev && prev.answer === data.answer) return;
    F.answers[data.decision_id] = { answer: data.answer, from, at: msg.at };
    feed(prev ? `${from} corrige ${data.decision_id}: ${prev.answer} → ${data.answer}` : `${from} decide ${data.decision_id}: ${data.answer}`);
    renderScript();
  } else if (type === 'panel' && PANEL_ACTION[data.action]) {
    feed(`${from} ${PANEL_ACTION[data.action]}`);
  } else if (type === 'control' && from === FACILITATOR_ROLE) {
    feed(`Otra consola envía «${data.action}»`); // dos facilitadores en la misma sala
  }
}

function send(action, extra) {
  if (!F.hub || F.hub.status === 'off' || F.hub.status === 'error') { feed('⚠ Sin conexión con la sala: la orden no se ha enviado.'); return false; }
  F.hub.send('control', controlMessage(F.pack, action, extra));
  if (!F.hub.connected) feed('⚠ No hay ningún visor conectado: la orden no llegará a nadie.');
  return true;
}

/* ─────────────── Órdenes ─────────────── */

function startClock() {
  if (!F.startedAt) F.startedAt = Date.now();
}

function cmdStart() {
  if (!send('start')) return;
  startClock();
  feed('▶ Orden de comenzar');
  renderState();
}

function cmdGoto(target, label) {
  if (!send('goto', { target })) return;
  startClock();
  if (F.pausedAt) { F.pausedMs += Date.now() - F.pausedAt; F.pausedAt = null; }
  if (target.round_id) F.currentRound = target.round_id;
  if (target.kind === 'end') F.currentRound = null;
  feed(`⤳ Lanza ${label}`);
  renderScript();
  renderState();
}

function cmdPause() {
  if (F.pausedAt || !send('pause')) return;
  F.pausedAt = Date.now();
  feed('⏸ Pausa');
  renderState();
}

function cmdResume() {
  if (!send('resume')) return;
  if (F.pausedAt) { F.pausedMs += Date.now() - F.pausedAt; F.pausedAt = null; }
  feed('⏵ Reanuda');
  renderState();
}

function cmdMessage(e) {
  e.preventDefault();
  const text = $('msg-text').value.trim();
  const to = $('msg-to').value;
  if (!text || !send('message', { text, to })) return;
  feed(`📣 Aviso${to === 'ALL' ? '' : ' a ' + to}: «${text}»`);
  $('msg-text').value = '';
}

/* ─────────────── Pintado ─────────────── */

function feed(text) {
  const li = el('li');
  li.append(el('time', hhmmss()), document.createTextNode(text));
  $('c-feed').prepend(li);
}

function renderPeers() {
  const byRole = new Map();
  if (F.hub) for (const p of F.hub.peers.values()) if (p.role !== FACILITATOR_ROLE) byRole.set(p.role, p);
  const rows = F.pack.roles.map((r) => {
    const p = byRole.get(r.id);
    byRole.delete(r.id);
    const tr = el('tr');
    tr.append(el('td', r.name), el('td', p ? '● conectado' : '○ sin conexión', p ? 'on' : 'off'), el('td', p ? (p.label || 'preparando') : '—'));
    return tr;
  });
  // Visores con un rol que no es del pack (otro ejercicio o pack distinto con el mismo código).
  for (const [role, p] of byRole) {
    const tr = el('tr');
    tr.append(el('td', role), el('td', '● conectado (rol desconocido en este pack)', 'off'), el('td', p.label || '—'));
    rows.push(tr);
  }
  $('c-peers').replaceChildren(...rows);
}

function renderState() {
  const box = $('c-state').parentElement;
  box.classList.toggle('paused', !!F.pausedAt);
  $('c-state').textContent = F.pausedAt ? 'En pausa' : F.startedAt ? 'En curso' : 'Esperando a los visores';
  $('btn-pause').disabled = !!F.pausedAt;
  $('btn-resume').disabled = !F.pausedAt;
}

function tickClock() {
  if (!F.startedAt) return;
  const now = F.pausedAt || Date.now();
  const sec = Math.max(0, Math.floor((now - F.startedAt - F.pausedMs) / 1000));
  $('c-clock').textContent = new Date(sec * 1000).toISOString().substring(11, 19);
}

function launchButton(label, target, title) {
  const b = el('button', label);
  b.type = 'button';
  b.addEventListener('click', () => cmdGoto(target, title));
  return b;
}

function renderScript() {
  const showKey = $('opt-key').checked;
  const proposed = F.pack.debrief && F.pack.debrief.status === 'propuesta';
  const blocks = F.pack.rounds.map((round) => {
    const box = el('div', null, 'round' + (F.currentRound === round.id ? ' current' : ''));
    const head = el('div', null, 'round-head');
    const titles = el('div');
    titles.append(el('h3', `Ronda ${round.number} · ${round.title}`), el('span', `${round.crisis_time} · ${(round.events || []).length} injects · ${(round.decisions || []).length} decisiones`, 'meta'));
    head.append(titles, launchButton('Lanzar ronda', { kind: 'round', round_id: round.id }, `la ronda ${round.number}`));
    const items = el('ul', null, 'items');
    for (const ev of round.events || []) {
      const li = el('li');
      const what = el('div', null, 'what');
      what.append(el('span', `${TYPE_LABEL[ev.type] || ev.type} · ${ev.title || ev.source || ev.id}`));
      what.append(el('small', `${ev.id}${ev.target && ev.target !== 'ALL' ? ' · para ' + ev.target : ''}`));
      li.append(what, launchButton('Lanzar', { kind: 'inject', round_id: round.id, inject_id: ev.id }, `el inject ${ev.id}`));
      items.appendChild(li);
    }
    for (const d of round.decisions || []) {
      const li = el('li');
      const what = el('div', null, 'what');
      what.append(el('span', `${d.id} · decide ${d.role}`), el('small', d.question));
      const got = F.answers[d.id];
      const ref = assessmentFor(F.pack, d);
      const preferred = ref && ref.preferred_response;
      let cls = 'answer pending';
      if (got) cls = 'answer' + (showKey && preferred ? (got.answer === preferred ? ' match' : ' miss') : '');
      const ans = el('div', null, cls);
      ans.append(document.createTextNode(got ? `Respuesta ${got.answer}` : 'pendiente'));
      if (showKey && preferred) ans.append(el('div', `referencia ${preferred}${proposed ? ' (propuesta)' : ''}`, 'key'));
      li.append(what, ans);
      items.appendChild(li);
    }
    box.append(head, items);
    return box;
  });
  const end = el('div', null, 'round');
  const endHead = el('div', null, 'round-head');
  endHead.append(el('h3', 'Final del ejercicio'), launchButton('Lanzar final', { kind: 'end' }, 'el final del ejercicio'));
  end.append(endHead);
  $('c-script').replaceChildren(...blocks, end);
}

/* ─────────────── Guion imprimible ─────────────── */

// Hoja del ejercicio para el facilitador, generada desde el pack: así nunca se desactualiza.
// Incluye la clave de respuestas solo si está marcada «Mostrar la clave de respuestas».
export function buildPrintSheet() {
  const pack = F.pack;
  const m = pack.manifest;
  const withKey = $('opt-key').checked;
  const proposed = pack.debrief && pack.debrief.status === 'propuesta';
  const perRound = m.duration_minutes && pack.rounds.length ? Math.round(m.duration_minutes / pack.rounds.length) : null;
  const sheet = $('print-sheet');
  const add = (parent, tag, text, cls) => { const n = el(tag, text, cls); parent.appendChild(n); return n; };
  const tableOf = (parent, head, rows) => {
    const t = add(parent, 'table');
    const tr = add(add(t, 'thead'), 'tr');
    for (const h of head) add(tr, 'th', h);
    const tb = add(t, 'tbody');
    for (const r of rows) { const row = add(tb, 'tr'); for (const c of r) add(row, 'td', c); }
    return t;
  };
  sheet.replaceChildren();

  add(sheet, 'p', 'SIMULACRO DE CONTINUIDAD MR · GUION DEL FACILITADOR', 'kicker');
  add(sheet, 'h1', m.name);
  const grid = add(sheet, 'div', null, 'meta-grid');
  const meta = [['Versión', m.version], ['Rondas / decisiones', `${pack.rounds.length} / ${pack.decisionCount}`],
    ['Duración del juego', m.duration_minutes ? `${m.duration_minutes} min${perRound ? ` (≈ ${perRound} min por ronda)` : ''}` : '—'],
    ['Código de sesión', F.sessionId || '________________']];
  for (const [k, v] of meta) { const c = add(grid, 'div'); add(c, 'b', k); add(c, 'span', v, k === 'Código de sesión' ? 'code' : null); }
  if (m.intro) add(sheet, 'p', m.intro, 'muted');
  if (withKey) {
    add(sheet, 'p', 'Contiene la clave de respuestas: no la dejes a la vista de los participantes.' +
      (proposed ? ' La clave es una PROPUESTA pendiente de validar.' : ''), 'warn');
  }

  add(sheet, 'h2', 'Roles');
  tableOf(sheet, ['Rol', 'Funciones'], pack.roles.map((r) => [r.name, (r.functions || []).join(' ')]));

  pack.rounds.forEach((round, i) => {
    const box = add(sheet, 'section', null, 'round' + (i === 0 ? ' first' : ''));
    add(box, 'h2', `Ronda ${round.number} de ${pack.rounds.length} · ${round.title}`);
    add(box, 'p', `Tiempo de crisis ${round.crisis_time}${perRound ? ` · ≈ ${perRound} min de juego` : ''}`, 'muted');
    add(box, 'p', 'Hora de inicio: ________     Observaciones: ____________________________________________', 'notes');
    if ((round.events || []).length) {
      add(box, 'h3', 'Injects');
      tableOf(box, ['Id', 'Tipo', 'Qué llega', 'Para'], round.events.map((e) => [
        e.id, TYPE_LABEL[e.type] || e.type, [e.title || e.source, e.text].filter(Boolean).join(' — '), e.target && e.target !== 'ALL' ? e.target : 'Todos']));
    }
    if ((round.panel_actions || []).length) {
      add(box, 'h3', 'Actuaciones en el Panel de Crisis');
      tableOf(box, ['Id', 'Pestaña', 'Qué se pide', 'Cuándo'], round.panel_actions.map((a) => [
        a.id, a.tab || '—', a.text, a.when === 'after' ? 'Tras las decisiones' : 'Antes de decidir']));
    }
    for (const dcs of round.decisions || []) {
      add(box, 'h3', `${dcs.id} · decide ${dcs.role}`);
      const card = add(box, 'div', null, 'decision');
      add(card, 'p', dcs.question).style.fontWeight = 'bold';
      const ref = assessmentFor(pack, dcs);
      const preferred = withKey && ref ? ref.preferred_response : null;
      const ul = add(card, 'ul', null, 'options');
      for (const a of dcs.answers) add(ul, 'li', `${a.id}) ${a.text}${a.id === preferred ? '   ← referencia' : ''}`, a.id === preferred ? 'ref' : null);
      if (preferred && ref.rationale) add(card, 'p', `Por qué: ${ref.rationale}`, 'why');
    }
  });

  if (m.ending) { add(sheet, 'h2', 'Final'); add(sheet, 'p', m.ending, 'muted'); }
  return sheet;
}

function printSheet() {
  buildPrintSheet();
  window.print();
}

/* ─────────────── Arranque ─────────────── */

function wire() {
  $('btn-start').addEventListener('click', cmdStart);
  $('btn-pause').addEventListener('click', cmdPause);
  $('btn-resume').addEventListener('click', cmdResume);
  $('btn-end').addEventListener('click', () => {
    if (confirmEnd()) cmdGoto({ kind: 'end' }, 'el final del ejercicio');
  });
  $('msg-form').addEventListener('submit', cmdMessage);
  $('opt-key').addEventListener('change', renderScript);
  $('btn-print').addEventListener('click', printSheet);
  $('btn-leave').addEventListener('click', closeConsole);
  setInterval(tickClock, 500);
  window.addEventListener('beforeunload', () => { if (F.hub) F.hub.stop(); });
}

// Doble pulsación en vez de un diálogo del navegador: «Finalizar» pide confirmación durante 4 s.
let endArmed = 0;
function confirmEnd() {
  const b = $('btn-end');
  if (Date.now() - endArmed < 4000) { endArmed = 0; b.textContent = '🏁 Finalizar'; return true; }
  endArmed = Date.now();
  b.textContent = '¿Seguro? Pulsa otra vez';
  setTimeout(() => { if (endArmed && Date.now() - endArmed >= 4000) { endArmed = 0; b.textContent = '🏁 Finalizar'; } }, 4100);
  return false;
}

wire();
show('screen-setup');
initSetup();
