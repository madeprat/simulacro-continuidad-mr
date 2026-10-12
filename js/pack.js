// Carga y validación de packs de ejercicio (EXERCISE_PACK v1).
// El pack solo aporta datos: el motor rechaza tipos desconocidos y nunca evalúa código del pack.

import { validateSite } from './site-model.js';

export const SUPPORTED_SCHEMA = 'crisis.exercise/1.0';
export const EVENT_TYPES = ['PHONE', 'DOCUMENT', 'ALERT', 'MESSAGE', 'MEDIA', 'INFO_CARD'];
export const ANCHORS = ['TV', 'DOOR', 'TABLE', 'FRONT'];
const ANSWER_IDS = ['A', 'B', 'C', 'D'];
const SEVERITIES = ['high', 'medium', 'low'];

// Traduce la pestaña que nombra una actuación del pack («⚡ Activación», «🗂 Historial»…) a una pestaña del panel.
export function tabFor(label = '') {
  const l = label.toLowerCase();
  if (l.includes('activ')) return 'activation';
  if (l.includes('impacto') || l.includes('historial')) return 'impact';
  if (l.includes('nivel')) return 'level';
  if (l.includes('servicio')) return 'services';
  if (l.includes('comit')) return 'committee';
  if (l.includes('comunica')) return 'comms';
  return null;
}


async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo leer ${url} (${res.status})`);
  return res.json();
}

export async function loadPackIndex() {
  return getJSON('packs/index.json');
}

export async function loadPack(basePath) {
  const base = basePath.replace(/\/?$/, '/');
  const manifest = await getJSON(base + 'manifest.json');
  const files = manifest.files || {};
  const [roles, rounds, debrief, site] = await Promise.all([
    getJSON(base + (files.roles || 'roles.json')),
    getJSON(base + (files.rounds || 'rounds.json')),
    files.debrief ? getJSON(base + files.debrief).catch(() => ({})) : Promise.resolve({}),
    // Maqueta de la organización (opcional): si el pack la declara y no se puede leer, es un error del pack.
    files.site ? getJSON(base + files.site).catch((e) => ({ __error: e.message })) : Promise.resolve(null),
  ]);
  const pack = { base, manifest, roles: roles.roles || [], rounds: rounds.rounds || [], debrief, site };
  pack.errors = validatePack(pack);
  pack.decisionCount = pack.rounds.reduce((n, r) => n + (r.decisions || []).length, 0);
  return pack;
}

export function validatePack(pack) {
  const errors = [];
  const m = pack.manifest;
  if (m.schema !== SUPPORTED_SCHEMA) errors.push(`Esquema no soportado: ${m.schema} (se espera ${SUPPORTED_SCHEMA}).`);
  if (!m.exercise_id) errors.push('manifest.exercise_id vacío.');
  if (!m.version) errors.push('manifest.version vacío.');

  const roleIds = new Set(pack.roles.map((r) => r.id));
  if (m.expected_players && roleIds.size !== m.expected_players) {
    errors.push(`Se esperan ${m.expected_players} roles y el pack define ${roleIds.size}.`);
  }
  if (!pack.rounds.length) errors.push('El pack no contiene rondas.');

  const ids = new Set();
  const seen = (id, where) => {
    if (!id) errors.push(`${where}: falta id.`);
    else if (ids.has(id)) errors.push(`${where}: id duplicado ${id}.`);
    ids.add(id);
  };

  for (const r of pack.rounds) {
    const where = `Ronda ${r.id}`;
    seen(r.id, where);
    for (const e of r.events || []) {
      seen(e.id, `${where}/evento`);
      if (!EVENT_TYPES.includes(e.type)) errors.push(`${where}/${e.id}: tipo de objeto desconocido «${e.type}».`);
      if (e.anchor && !ANCHORS.includes(e.anchor)) errors.push(`${where}/${e.id}: ancla desconocida «${e.anchor}».`);
      if (e.target && e.target !== 'ALL' && !roleIds.has(e.target)) errors.push(`${where}/${e.id}: rol destino inexistente ${e.target}.`);
      if (e.media) errors.push(`${where}/${e.id}: los medios aún no están soportados en esta versión del motor.`);
    }
    for (const a of r.panel_actions || []) {
      seen(a.id, `${where}/acción en el panel`);
      if (a.when && !['before', 'after'].includes(a.when)) errors.push(`${where}/${a.id}: «when» debe ser before/after.`);
      if (a.tab && !tabFor(a.tab)) errors.push(`${where}/${a.id}: pestaña del panel desconocida «${a.tab}».`);
    }
    for (const d of r.decisions || []) {
      seen(d.id, `${where}/decisión`);
      if (!roleIds.has(d.role)) errors.push(`${where}/${d.id}: rol inexistente ${d.role}.`);
      const answers = d.answers || [];
      if (answers.length !== 4 || answers.some((a, i) => a.id !== ANSWER_IDS[i] || !a.text)) {
        errors.push(`${where}/${d.id}: debe tener cuatro respuestas A–D con texto.`);
      }
    }
  }
  // Estado del copiloto al empezar cada ronda: «D0 07:33», escenarios E1… con categoría 1–3.
  const TIME = /^D\d+\s+\d{1,2}:\d{2}$/;
  for (const r of pack.rounds) {
    const c = r.copilot;
    if (!c) continue;
    for (const k of ['clock', 'declared', 'onset']) {
      if (c[k] != null && !TIME.test(String(c[k]).trim())) errors.push(`Ronda ${r.id}/copilot.${k}: formato «D0 07:33» esperado, se encontró «${c[k]}».`);
    }
    if (!c.clock) errors.push(`Ronda ${r.id}/copilot: falta «clock».`);
    for (const [code, cat] of Object.entries(c.scenarios || {})) {
      if (!/^E\d+$/i.test(code)) errors.push(`Ronda ${r.id}/copilot: escenario «${code}» no válido.`);
      if (![1, 2, 3].includes(Number(cat))) errors.push(`Ronda ${r.id}/copilot: la categoría de ${code} debe ser 1, 2 o 3.`);
    }
    if (c.status && !['active', 'contained', 'closed'].includes(c.status)) errors.push(`Ronda ${r.id}/copilot: estado «${c.status}» no válido.`);
  }
  // Hoja de respuestas (debrief.json): solo decisiones existentes y letras A–D.
  const decisionIds = new Set(pack.rounds.flatMap((r) => (r.decisions || []).map((d) => d.id)));
  for (const [id, a] of Object.entries((pack.debrief && pack.debrief.assessments) || {})) {
    if (!decisionIds.has(id)) errors.push(`debrief.json: la decisión ${id} no existe en el pack.`);
    else if (a.preferred_response && !ANSWER_IDS.includes(a.preferred_response)) errors.push(`debrief.json/${id}: respuesta de referencia «${a.preferred_response}» no válida.`);
    if (a.severity_if_missed && !SEVERITIES.includes(a.severity_if_missed)) errors.push(`debrief.json/${id}: gravedad «${a.severity_if_missed}» no válida (high, medium o low).`);
    const caps = pack.debrief && pack.debrief.capabilities;
    if (a.capability && caps && !caps[a.capability]) errors.push(`debrief.json/${id}: la capacidad «${a.capability}» no tiene etiqueta en «capabilities».`);
  }
  if (pack.site) {
    if (pack.site.__error) errors.push(`site.json: ${pack.site.__error}`);
    else for (const e of validateSite(pack.site)) errors.push(`site.json: ${e}`);
  }
  if (m.decision_count && m.decision_count !== pack.rounds.reduce((n, r) => n + (r.decisions || []).length, 0)) {
    errors.push(`manifest.decision_count (${m.decision_count}) no coincide con las decisiones del pack.`);
  }
  if (m.round_count && m.round_count !== pack.rounds.length) {
    errors.push(`manifest.round_count (${m.round_count}) no coincide con las rondas del pack (${pack.rounds.length}).`);
  }
  return errors;
}

// Secuencia lineal de pasos según el flujo estándar de ronda (01.4 del diseño).
export function buildSteps(pack) {
  const steps = [];
  for (const round of pack.rounds) {
    steps.push({ kind: 'round_intro', round });
    for (const event of round.events || []) steps.push({ kind: 'event', round, event });
    const actions = round.panel_actions || [];
    for (const action of actions.filter((a) => (a.when || 'before') === 'before')) steps.push({ kind: 'panel', round, action });
    for (const decision of round.decisions || []) steps.push({ kind: 'decision', round, decision });
    for (const action of actions.filter((a) => a.when === 'after')) steps.push({ kind: 'panel', round, action });
    steps.push({ kind: 'round_end', round });
  }
  steps.push({ kind: 'end' });
  return steps;
}

export function findDecision(pack, id) {
  for (const round of pack.rounds) for (const decision of round.decisions || []) if (decision.id === id) return { round, decision };
  return null;
}

// Respuesta recibida de otro visor: solo se acepta si la envía el rol que decide, con una letra A–D
// y para una decisión que existe en el pack. Devuelve { round, decision, answer, from } o null.
export function acceptRemoteAnswer(pack, msg) {
  const found = msg && findDecision(pack, msg.decision_id);
  if (!found || msg.from !== found.decision.role || !ANSWER_IDS.includes(msg.answer)) return null;
  return { ...found, answer: msg.answer, from: msg.from };
}

export function assessmentFor(pack, decision) {
  return decision.assessment || (pack.debrief.assessments || {})[decision.id] || null;
}
