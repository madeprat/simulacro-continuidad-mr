// Pantallas flotantes del Copiloto de Continuidad en las gafas.
// Usa el mismo motor de cálculo que la página del copiloto (copiloto/js/core.js) y el estado de ronda del pack,
// así cada visor calcula lo mismo que muestra la TV sin necesidad de red.
import * as core from '../copiloto/js/core.js';
import { THEME } from './panel.js';

const LEVEL_ACCENT = { 1: THEME.green, 2: THEME.amber, 3: THEME.red };
const TONE_ACCENT = { ok: THEME.green, warn: THEME.amber, danger: THEME.red, critical: THEME.red };

// Qué ve cada rol junto a la TV.
export const WIDGETS_BY_ROLE = {
  R1: ['level', 'pressure'],
  R2: ['level', 'services'],
  R3: ['comms', 'pressure'],
};

export async function loadCopilotData(base = 'copiloto/data/') {
  const get = async (f) => (await fetch(base + f, { cache: 'no-cache' })).json();
  const [config, services, scenarios, estrategias] = await Promise.all(['config.json', 'servicios.json', 'escenarios.json', 'estrategias.json'].map(get));
  return { config, services, scenarios, estrategias };
}

export function roundState(round, baseMs = core.exerciseBase()) {
  return core.roundCopilotState(round, baseMs);
}

export function computeSnapshot(data, st, realElapsedMs) {
  if (!st || !Object.keys(st.selected).length) return null;
  return core.snapshot(data, { ...st, nowMs: st.nowMs + realElapsedMs });
}

function levelSpec(snap) {
  const l = snap.level;
  const lines = [`${l.affected} servicios · RTO mínimo ${core.fmtHoras(l.minRto)}`, `Pérdida/hora ${core.fmtEur(l.totalLossHour)}`];
  if (l.hardTriggers.length) lines.push('', 'Escalada automática:', ...l.hardTriggers.map((t) => '• ' + t));
  return {
    accent: LEVEL_ACCENT[l.level], icon: '🎯', kicker: 'Copiloto · Nivel',
    title: `N${l.level} · ${l.title.split('· ')[1] || l.title}`,
    source: snap.scenarios.map((s) => `${s.code} C${s.category}`).join(' + '),
    body: lines.join('\n'),
    note: l.committeeRecommended ? 'Se recomienda activar el comité de continuidad.' : 'No se requiere activación de comité en este momento.',
    noteColor: l.committeeRecommended ? THEME.amber : THEME.muted,
  };
}

function pressureSpec(snap, config) {
  const p = snap.pressure;
  return {
    accent: TONE_ACCENT[snap.label.cls], icon: '⏱', kicker: 'Copiloto · Reloj de seguimiento',
    title: core.fmtHMS(snap.elapsed),
    body: `Pérdida acumulada ${core.fmtEur(p.totalLoss)}\nUmbral de escalada ${core.fmtEur(parseFloat(config.umbral_perdida_eur || 5000))}`,
    note: snap.label.text + (p.disaster ? ' · condición de desastre' : ''),
    noteColor: TONE_ACCENT[snap.label.cls],
  };
}

function servicesSpec(snap) {
  const top = snap.affected.slice(0, 5).map((s) => `${s.codigo} · RTO ${core.fmtHoras(s.rto_h)} · ${core.zoneText(s, snap.elapsed)}`);
  const c = snap.pressure.counts;
  return {
    accent: TONE_ACCENT[snap.pressure.overallTone], icon: '🧭', kicker: 'Copiloto · Servicios por RTO',
    title: `${snap.affected.length} servicios expuestos`,
    body: top.join('\n') + (snap.affected.length > 5 ? `\n… y ${snap.affected.length - 5} más` : ''),
    note: `MTPD superado ${c.critical} · RTO superado ${c.danger} · En riesgo ${c.warn}`,
    noteColor: THEME.muted,
  };
}

function commsSpec(snap) {
  const r = snap.rgpd;
  const now = core.getCommsForCtx('seguridad').filter((i) => i.mandatory && i.bucket === 'now').length;
  const pub = core.getCommsForCtx('publico').length;
  const priv = core.getCommsForCtx('privacidad').filter((i) => i.mandatory).length;
  return {
    accent: r.expired ? THEME.red : r.cls === 'danger' ? THEME.red : THEME.amber, icon: '📡', kicker: 'Copiloto · Comunicaciones',
    title: r.expired ? 'Plazo RGPD 72 h vencido' : `RGPD 72 h: quedan ${r.hours} h ${r.minutes} min`,
    body: `Seguridad: ${now} obligatorias «ahora»\nCliente público: ${pub} comunicaciones\nDatos personales: ${priv} obligatorias`,
    note: 'Detalle y fichas en la pestaña Comunicaciones de la TV.', noteColor: THEME.muted,
  };
}

export function widgetSpecs(role, snap, config) {
  if (!snap) {
    return [{
      accent: THEME.border, icon: '🛰', kicker: 'Copiloto de Continuidad',
      title: 'Sin incidente declarado', body: 'El panel de la TV aún no tiene escenarios activos.',
    }];
  }
  const build = { level: () => levelSpec(snap), pressure: () => pressureSpec(snap, config), services: () => servicesSpec(snap), comms: () => commsSpec(snap) };
  return (WIDGETS_BY_ROLE[role] || ['level', 'pressure']).map((w) => build[w]());
}
