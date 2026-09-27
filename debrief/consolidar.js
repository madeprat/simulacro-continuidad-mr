// Consolidación de los registros de sesión de los visores (R1/R2/R3) en una evidencia única.
// Regla (diseño, cap. 07.4): para cada decisión, la fuente principal es el visor cuyo rol era el activo;
// los demás aportan la respuesta observada y se marcan las discrepancias. Los originales no se modifican.

export const SESSION_SCHEMA = 'crisis.session/1.0';
export const CONSOLIDATED_SCHEMA = 'crisis.consolidated/1.0';

export async function sha256(text) {
  if (!globalThis.crypto || !crypto.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateLogs(logs) {
  const errors = [];
  const warnings = [];
  if (!logs.length) errors.push('No hay registros cargados.');
  for (const l of logs) {
    if (l.data.schema !== SESSION_SCHEMA) errors.push(`${l.name}: esquema «${l.data.schema}» no soportado.`);
  }
  const key = (l) => `${l.data.exercise?.id}|${l.data.exercise?.version}|${l.data.session_id}`;
  const keys = [...new Set(logs.map(key))];
  if (keys.length > 1) errors.push('Los registros no son de la misma sesión (ejercicio, versión o código de sesión distintos).');
  const roles = logs.map((l) => l.data.local_role);
  const dup = roles.filter((r, i) => roles.indexOf(r) !== i);
  if (dup.length) warnings.push(`Hay más de un registro del rol ${[...new Set(dup)].join(', ')}; se usa el primero como fuente principal.`);
  for (const l of logs) if (!l.data.completed_at) warnings.push(`${l.name}: la sesión de ${l.data.local_role} no se completó.`);
  return { errors, warnings };
}

// pack (opcional): { rounds, debrief } para ordenar, mostrar preguntas y valoración de referencia.
export function consolidate(logs, pack = null) {
  const byRole = {};
  for (const l of logs) if (!byRole[l.data.local_role]) byRole[l.data.local_role] = l;
  const order = [];
  if (pack) for (const r of pack.rounds) for (const d of r.decisions || []) order.push({ round: r, decision: d });
  else {
    const seen = new Set();
    for (const l of logs) for (const rec of Object.values(l.data.decisions || {})) {
      if (!seen.has(rec.decision_id)) { seen.add(rec.decision_id); order.push({ round: { id: rec.round_id }, decision: { id: rec.decision_id, role: rec.active_role } }); }
    }
  }
  const assessments = (pack && pack.debrief && pack.debrief.assessments) || {};

  const decisions = order.map(({ round, decision }) => {
    const primaryLog = byRole[decision.role];
    const primary = primaryLog ? primaryLog.data.decisions?.[decision.id] : null;
    const observed = {};
    for (const l of logs) {
      if (l === primaryLog) continue;
      const rec = l.data.decisions?.[decision.id];
      if (rec) observed[l.data.local_role] = rec.answer;
    }
    const allAnswers = [primary?.answer, ...Object.values(observed)].filter(Boolean);
    const distinct = [...new Set(allAnswers)];
    let answer = primary?.answer || null;
    let status = 'ok';
    if (!primary) {
      status = allAnswers.length ? 'sin_fuente_propia' : 'sin_respuesta';
      if (allAnswers.length) {
        const counts = {};
        for (const a of allAnswers) counts[a] = (counts[a] || 0) + 1;
        answer = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      }
    }
    if (distinct.length > 1) status = 'discrepancia';
    const assessment = decision.assessment || assessments[decision.id] || null;
    let rating = 'no_evaluada';
    if (answer && assessment && assessment.preferred_response) rating = answer === assessment.preferred_response ? 'esperada' : 'desviacion';
    return {
      round_id: round.id, decision_id: decision.id, active_role: decision.role, question: decision.question || '',
      answer, source: primary ? 'own' : allAnswers.length ? 'observed' : null,
      response_seconds: primary?.response_seconds ?? null, answered_at: primary?.answered_at ?? null,
      observed, status, reference_rating: rating, capability: assessment?.capability || null,
      preferred_response: assessment?.preferred_response || null, severity_if_missed: assessment?.severity_if_missed || null,
      rationale: assessment?.rationale || null, sync_from: primary ? null : (logs.map((l) => l.data.decisions?.[decision.id]?.sync_from).find(Boolean) || null),
    };
  });

  const capLabels = (pack && pack.debrief && pack.debrief.capabilities) || {};
  const capabilities = capabilitySummary(decisions, capLabels);
  const panel = panelEvidence(logs);
  const findings = suggestFindings(decisions, capLabels);

  // Los eventos comunes a todos los visores se toman de un único registro de referencia para no triplicarlos.
  const SHARED = ['round_started', 'round_completed', 'inject_shown', 'inject_acknowledged', 'decision_shown', 'panel_action_shown'];
  const reference = byRole[Object.keys(byRole).sort()[0]];
  const timeline = [];
  for (const l of logs) {
    for (const e of l.data.events || []) {
      if (e.type === 'decision_answered' && e.answer_source !== 'own') continue;
      if (SHARED.includes(e.type) && l !== reference) continue;
      timeline.push({ at: e.at, role: l.data.local_role, type: e.type, detail: describe(e) });
    }
  }
  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const perRole = Object.fromEntries(Object.entries(byRole).map(([role, l]) => {
    const own = Object.values(l.data.decisions || {}).filter((d) => d.answer_source === 'own');
    const times = own.map((d) => d.response_seconds).filter((t) => typeof t === 'number');
    const ev = l.data.events || [];
    return [role, {
      file: l.name, own_decisions: own.length,
      avg_response_seconds: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null,
      max_response_seconds: times.length ? Math.max(...times) : null,
      panel_actions_confirmed: ev.filter((e) => e.type === 'panel_action_confirmed').length,
      corrections: ev.filter((e) => e.type === 'session_corrected').length,
      started_at: l.data.started_at, completed_at: l.data.completed_at,
    }];
  }));

  const first = logs[0]?.data || {};
  return {
    schema: CONSOLIDATED_SCHEMA,
    exercise: first.exercise, session_id: first.session_id,
    roles_loaded: Object.keys(byRole).sort(),
    summary: {
      decisions_total: decisions.length,
      decisions_with_answer: decisions.filter((d) => d.answer).length,
      decisions_own_source: decisions.filter((d) => d.source === 'own').length,
      discrepancies: decisions.filter((d) => d.status === 'discrepancia').length,
      without_own_source: decisions.filter((d) => d.status === 'sin_fuente_propia').length,
      unanswered: decisions.filter((d) => d.status === 'sin_respuesta').length,
    },
    answer_sheet_status: (pack && pack.debrief && pack.debrief.status) || null,
    capabilities, panel_evidence: panel, suggested_findings: findings,
    per_role: perRole, decisions, timeline,
  };
}

// Resultado por capacidad del sistema de gestión de continuidad (base del debrief, no una nota global).
export function capabilitySummary(decisions, labels = {}) {
  const by = {};
  for (const d of decisions) {
    if (!d.capability) continue;
    const c = (by[d.capability] = by[d.capability] || { id: d.capability, label: labels[d.capability] || d.capability, total: 0, answered: 0, expected: 0, deviations: 0, high_deviations: 0, times: [] });
    c.total++;
    if (d.answer) c.answered++;
    if (d.reference_rating === 'esperada') c.expected++;
    if (d.reference_rating === 'desviacion') { c.deviations++; if (d.severity_if_missed === 'high') c.high_deviations++; }
    if (typeof d.response_seconds === 'number') c.times.push(d.response_seconds);
  }
  return Object.values(by).map(({ times, ...c }) => ({
    ...c,
    expected_pct: c.answered ? Math.round((c.expected / c.answered) * 100) : null,
    avg_response_seconds: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null,
    status: !c.answered ? 'sin_datos' : c.high_deviations ? 'mejorar' : c.deviations ? 'revisar' : 'adecuada',
  })).sort((a, b) => (b.high_deviations - a.high_deviations) || (b.deviations - a.deviations) || a.label.localeCompare(b.label));
}

// Actuaciones reales sobre el Panel de Crisis, por ronda (sin duplicar lo que cada visor calcula por su cuenta).
export function panelEvidence(logs) {
  const TYPES = ['panel_analyzed', 'panel_onset_set', 'panel_status', 'panel_disaster', 'panel_comm_marked', 'panel_committee_convened', 'panel_action_confirmed'];
  const out = [];
  const seen = new Set();
  for (const l of logs) {
    for (const e of l.data.events || []) {
      if (!TYPES.includes(e.type)) continue;
      // La condición de desastre y las confirmaciones de actuación las registra cada visor: se toma la primera por ronda.
      if (e.type === 'panel_disaster' || e.type === 'panel_action_confirmed') {
        const key = e.type + '|' + e.round_id + '|' + (e.action_id || '');
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push({ at: e.at, round_id: e.round_id || null, role: l.data.local_role, type: e.type, detail: describe(e) });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// Propuesta de hallazgos para que el facilitador los revise, edite o descarte.
export function suggestFindings(decisions, labels = {}) {
  const out = [];
  for (const d of decisions) {
    const cap = labels[d.capability] || d.capability || 'General';
    if (d.reference_rating === 'desviacion') {
      out.push({
        id: 'F-' + d.decision_id, decision_id: d.decision_id, capability: cap, severity: d.severity_if_missed || 'medium',
        text: `${d.decision_id} (${d.active_role}): se eligió ${d.answer}; la respuesta de referencia es ${d.preferred_response}.`,
        action: d.rationale ? 'Reforzar: ' + d.rationale : 'Revisar el criterio en el plan y formar al rol.',
      });
    } else if (d.status === 'discrepancia') {
      out.push({ id: 'F-' + d.decision_id + '-sync', decision_id: d.decision_id, capability: cap, severity: 'low',
        text: `${d.decision_id}: los visores registraron letras distintas (${[d.answer, ...Object.values(d.observed)].join(' / ')}).`,
        action: 'Revisar el protocolo de anuncio en voz alta de la decisión.' });
    } else if (!d.answer) {
      out.push({ id: 'F-' + d.decision_id + '-nr', decision_id: d.decision_id, capability: cap, severity: 'medium',
        text: `${d.decision_id} (${d.active_role}): sin respuesta registrada.`, action: 'Comprobar si la decisión se tomó y no se registró.' });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function describe(e) {
  switch (e.type) {
    case 'session_started': return `Inicio de sesión (motor ${e.engine_version})`;
    case 'session_resumed': return 'Sesión reanudada';
    case 'session_completed': return 'Sesión completada';
    case 'round_started': return `Ronda ${e.round_id} · ${e.crisis_time}`;
    case 'round_completed': return `Fin de ronda ${e.round_id}`;
    case 'inject_shown': return `Inject ${e.inject_id} (${e.inject_type})`;
    case 'inject_opened': return `Abre inject ${e.inject_id}`;
    case 'inject_acknowledged': return `Inject ${e.inject_id} leído`;
    case 'panel_action_shown': return `Actuación en panel ${e.action_id}`;
    case 'panel_action_confirmed': return `Actuación ${e.action_id} confirmada`;
    case 'decision_shown': return `Decisión ${e.decision_id} (${e.active_role})`;
    case 'decision_answered': return `${e.decision_id}: ${e.answer} en ${e.response_seconds} s`;
    case 'session_corrected': return e.decision_id ? `Corrección ${e.decision_id}: ${e.previous_answer} → ${e.new_answer}` : `Navegación manual ${e.from_step} → ${e.to_step}`;
    case 'copilot_toggled': return `Resumen del copiloto ${e.visible ? 'visible' : 'oculto'}`;
    case 'panel_analyzed': return `Panel: ${e.recalculated ? 'recalcula' : 'analiza'} impacto con ${Object.entries(e.scenarios || {}).map(([k, v]) => k + ' C' + v).join(' + ')}`;
    case 'panel_onset_set': return `Panel: inicio real ${e.onset_minutes_before_analysis} min antes del análisis`;
    case 'panel_status': return `Panel: seguimiento ${({ contained: 'pausado', active: 'reanudado', closed: 'cerrado' })[e.status] || e.status}`;
    case 'panel_disaster': return `Panel: condición de desastre (${e.loss_total} €)`;
    case 'panel_comm_marked': return `Panel: comunicación ${e.comm_id} marcada como notificada`;
    case 'panel_committee_convened': return 'Panel: convocatoria al comité';
    case 'panel_sync': return `Panel actualizado por ${e.from} (${e.action})`;
    case 'sync_joined': return `${e.role} se conecta a la sala`;
    default: return e.type;
  }
}

export function toCSV(result) {
  const roles = result.roles_loaded;
  const cols = ['session_id', 'exercise_id', 'exercise_version', 'round_id', 'decision_id', 'active_role', 'answer', 'source',
    'response_seconds', 'answered_at', ...roles.map((r) => `observed_${r}`), 'status', 'preferred_response', 'reference_rating', 'severity_if_missed', 'capability'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = result.decisions.map((d) => [result.session_id, result.exercise?.id, result.exercise?.version, d.round_id, d.decision_id,
    d.active_role, d.answer, d.source, d.response_seconds, d.answered_at, ...roles.map((r) => d.observed[r] || ''), d.status,
    d.preferred_response, d.reference_rating, d.severity_if_missed, d.capability].map(esc).join(','));
  return '﻿' + [cols.join(','), ...rows].join('\r\n') + '\r\n';
}

export function findingsCSV(result) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['session_id', 'exercise_id', 'id', 'decision_id', 'capability', 'severity', 'finding', 'action', 'owner', 'due'];
  const rows = (result.findings || []).map((f) => [result.session_id, result.exercise?.id, f.id, f.decision_id, f.capability, f.severity, f.text, f.action, f.owner, f.due].map(esc).join(','));
  return '﻿' + [cols.join(','), ...rows].join('\r\n') + '\r\n';
}
