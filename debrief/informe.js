// Informe del simulacro: un documento HTML autocontenido (tema claro, listo para A4) que se previsualiza en el
// debrief, se imprime como PDF, se descarga y se adjunta al correo. Función pura: recibe el consolidado, el pack
// y lo que ha editado el facilitador, y devuelve el HTML. Sin DOM, para poder probarlo en Node.
//
// Estructura: portada · resumen · resultado por competencias (gráfico) · cronología por ronda con hechos,
// actuaciones y decisiones (con la respuesta de referencia y por qué las demás no) · recomendaciones ·
// observaciones · anexo de integridad.

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SEV = { high: 'alta', medium: 'media', low: 'baja' };
const TYPE = { PHONE: 'Llamada', DOCUMENT: 'Documento', ALERT: 'Alerta', MESSAGE: 'Mensaje', MEDIA: 'Multimedia', INFO_CARD: 'Información' };
const COLORS = { ok: '#16a34a', dev: '#f59e0b', high: '#dc2626', none: '#cbd5e1' };

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—');
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const dur = (a, b) => {
  if (!a || !b) return '—';
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const answerText = (d, id) => ((d.answers || []).find((a) => a.id === id) || {}).text || '';

// Resumen numérico que comparten el informe, el correo y el histórico.
export function reportSummary(result) {
  const evaluated = result.decisions.filter((d) => d.reference_rating !== 'no_evaluada');
  const expected = evaluated.filter((d) => d.reference_rating === 'esperada').length;
  const high = result.decisions.filter((d) => d.reference_rating === 'desviacion' && d.severity_if_missed === 'high').length;
  const weak = result.capabilities.filter((c) => c.status === 'mejorar' || c.status === 'revisar').map((c) => c.label);
  return {
    decisions: result.decisions.length, evaluated: evaluated.length, expected,
    pct: evaluated.length ? Math.round((expected / evaluated.length) * 100) : null,
    high_deviations: high, discrepancies: result.summary.discrepancies, unanswered: result.summary.unanswered, weak,
  };
}

// Gráfico de barras horizontales por capacidad (SVG en línea, colores fijos para que se imprima igual).
export function competencyChart(capabilities) {
  const rows = capabilities.filter((c) => c.total);
  if (!rows.length) return '<p class="muted">Este ejercicio no tiene hoja de respuestas con capacidades.</p>';
  const W = 720, labelW = 250, barW = 360, rowH = 34, top = 30;
  const max = Math.max(...rows.map((c) => c.total));
  const unit = barW / max;
  const H = top + rows.length * rowH + 10;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Resultado por competencias" xmlns="http://www.w3.org/2000/svg">`;
  const legend = [['Como la referencia', COLORS.ok], ['Desviación', COLORS.dev], ['Desviación grave', COLORS.high], ['Sin respuesta', COLORS.none]];
  let lx = 0;
  legend.forEach(([t, c]) => {
    svg += `<rect x="${lx}" y="6" width="12" height="12" rx="3" fill="${c}"/><text x="${lx + 17}" y="16" class="lg">${esc(t)}</text>`;
    lx += 17 + t.length * 6.6 + 22;
  });
  rows.forEach((c, i) => {
    const y = top + i * rowH;
    const minor = c.deviations - c.high_deviations;
    const none = c.total - c.answered;
    svg += `<text x="${labelW - 10}" y="${y + 20}" text-anchor="end" class="lb">${esc(c.label)}</text>`;
    let x = labelW;
    for (const [n, col] of [[c.expected, COLORS.ok], [minor, COLORS.dev], [c.high_deviations, COLORS.high], [none, COLORS.none]]) {
      if (n > 0) { svg += `<rect x="${x}" y="${y + 6}" width="${n * unit - 2}" height="20" rx="4" fill="${col}"/>`; x += n * unit; }
    }
    svg += `<text x="${labelW + barW + 10}" y="${y + 20}" class="nb">${c.expected} de ${c.total}</text>`;
  });
  return svg + '</svg>';
}

function decisionCard(d) {
  const chosen = d.answer;
  let verdict, body = '';
  if (!chosen) {
    verdict = '<span class="tag t-none">Sin respuesta</span>';
    if (d.preferred_response) body += `<p><b>Respuesta de referencia: ${esc(d.preferred_response)}.</b> ${esc(answerText(d, d.preferred_response))}</p><p class="why">${esc(d.rationale)}</p>`;
  } else if (d.reference_rating === 'esperada') {
    verdict = '<span class="tag t-ok">Como la referencia</span>';
    body += `<p><b>Se eligió ${esc(chosen)}.</b> ${esc(answerText(d, chosen))}</p>`;
    if (d.rationale) body += `<p class="why"><b>Por qué es la adecuada:</b> ${esc(d.rationale)}</p>`;
  } else if (d.reference_rating === 'desviacion') {
    verdict = `<span class="tag ${d.severity_if_missed === 'high' ? 't-high' : 't-dev'}">Desviación${d.severity_if_missed ? ' · gravedad ' + SEV[d.severity_if_missed] : ''}</span>`;
    body += `<p><b>Se eligió ${esc(chosen)}.</b> ${esc(answerText(d, chosen))}</p>`;
    if (d.why_not_chosen) body += `<p class="whynot"><b>Por qué no era la mejor:</b> ${esc(d.why_not_chosen)}</p>`;
    body += `<p class="ref"><b>Respuesta de referencia: ${esc(d.preferred_response)}.</b> ${esc(answerText(d, d.preferred_response))}</p>`;
    if (d.rationale) body += `<p class="why"><b>Por qué:</b> ${esc(d.rationale)}</p>`;
  } else {
    verdict = '<span class="tag t-none">Sin referencia</span>';
    body += `<p><b>Se eligió ${esc(chosen)}.</b> ${esc(answerText(d, chosen))}</p>`;
  }
  const meta = [`Decide ${esc(d.active_role)}`, d.answered_at ? `a las ${hhmm(d.answered_at)}` : null, d.response_seconds != null ? `en ${String(d.response_seconds).replace('.', ',')} s` : null,
    d.status === 'discrepancia' ? 'los visores registraron letras distintas' : null].filter(Boolean).join(' · ');
  return `<div class="dec"><div class="dec-h"><span class="did">${esc(d.decision_id)}</span><span class="q">${esc(d.question)}</span>${verdict}</div><p class="meta">${meta}</p>${body}</div>`;
}

// options: { pack, findings, notes, generatedAt }
export function buildReport(result, { pack = null, findings = [], notes = '', generatedAt = new Date().toISOString() } = {}) {
  const s = reportSummary(result);
  const m = (pack && pack.manifest) || {};
  const name = m.name || result.exercise?.name || result.exercise?.id || 'Simulacro';
  const org = pack && pack.site && pack.site.name;
  const rounds = (pack && pack.rounds) || [];
  const eventById = {};
  for (const r of rounds) for (const e of r.events || []) eventById[e.id] = e;
  const roles = (pack && pack.roles) || [];
  const roleName = (id) => (roles.find((r) => r.id === id) || {}).name || id;

  // Cronología por ronda: hechos, actuaciones en el panel y decisiones, en orden de hora.
  const byRound = {};
  const push = (rid, item) => ((byRound[rid] = byRound[rid] || []).push(item));
  for (const f of result.facts || []) {
    const e = eventById[f.inject_id] || {};
    push(f.round_id, { at: f.at, html: `<div class="fact"><span class="time">${hhmm(f.at)}</span><span class="kind">${esc(TYPE[f.inject_type] || 'Hecho')}</span><div><b>${esc(e.title || f.inject_id)}</b>${e.source ? ` · <span class="muted">${esc(e.source)}</span>` : ''}<br>${esc(e.text || '')}</div></div>` });
  }
  for (const p of result.panel_evidence || []) {
    if (!p.round_id || p.type === 'panel_action_confirmed') continue;
    push(p.round_id, { at: p.at, html: `<div class="act"><span class="time">${hhmm(p.at)}</span><span class="kind">Panel · ${esc(p.role)}</span><div>${esc(p.detail)}</div></div>` });
  }
  for (const d of result.decisions) push(d.round_id, { at: d.answered_at || '9999', html: decisionCard(d) });
  const roundBlocks = (rounds.length ? rounds : [...new Set(result.decisions.map((d) => d.round_id))].map((id) => ({ id, number: '', title: id, crisis_time: '' })))
    .map((r) => {
      const items = (byRound[r.id] || []).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      if (!items.length) return '';
      return `<section class="round"><h3>Ronda ${esc(r.number)} · ${esc(r.title)}${r.crisis_time ? ` <span class="muted">· ${esc(r.crisis_time)}</span>` : ''}</h3>${items.map((i) => i.html).join('')}</section>`;
    }).join('');

  // Recomendaciones: los hallazgos incluidos, agrupados por capacidad y ordenados por gravedad.
  const order = { high: 0, medium: 1, low: 2 };
  const recs = findings.filter((f) => f.include !== false && (f.text || f.action));
  const groups = {};
  for (const f of recs.sort((a, b) => (order[a.severity] ?? 1) - (order[b.severity] ?? 1))) (groups[f.capability || 'General'] = groups[f.capability || 'General'] || []).push(f);
  // Por capacidad: la acción de mejora una sola vez y, debajo, las decisiones que la justifican.
  const recHtml = recs.length
    ? Object.entries(groups).map(([cap, list]) => {
      const actions = [...new Set(list.map((f) => f.action).filter(Boolean))];
      const worst = list[0].severity;
      return `<div class="recg sev-${esc(worst)}"><h4>${esc(cap)} <span class="tag ${worst === 'high' ? 't-high' : worst === 'low' ? 't-none' : 't-dev'}">prioridad ${esc(SEV[worst] || worst)}</span></h4>`
        + actions.map((a) => `<p class="todo">${esc(a)}</p>`).join('')
        + `<p class="evid">Evidencia en el ejercicio</p><ul>${list.map((f) => `<li>${esc(f.text)}${f.owner ? ` <b>Responsable:</b> ${esc(f.owner)}.` : ''}${f.due ? ` <b>Plazo:</b> ${esc(f.due)}.` : ''}</li>`).join('')}</ul></div>`;
    }).join('')
    : '<p>No hay desviaciones respecto a la referencia: se recomienda mantener el plan y repetir el ejercicio con un escenario más exigente.</p>';

  const weakTxt = s.weak.length ? `Las competencias a reforzar son: ${s.weak.join(', ')}.` : 'No hay competencias con desviaciones.';
  const people = Object.entries(result.participants || {}).map(([r, p]) => `<li>${esc(roleName(r))}${p ? ` · ${esc(p)}` : ''}</li>`).join('');
  const CHAIN = { integro: 'cadena íntegra', alterado: 'cadena ROTA', sin_cadena: 'sin cadena' };

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe · ${esc(name)} · ${esc(result.session_id)}</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #0f172a; background: #fff; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.page { max-width: 820px; margin: 0 auto; padding: 28px 24px 40px; }
.band { height: 6px; background: linear-gradient(90deg, #0f172a 0 70%, #dbf266 70%); border-radius: 3px; }
.kicker { margin: 18px 0 0; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #475569; }
h1 { font-size: 28px; line-height: 1.15; margin: 6px 0 4px; }
h2 { font-size: 18px; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #0f172a; }
h3 { font-size: 15px; margin: 22px 0 8px; }
h4 { font-size: 14px; margin: 14px 0 6px; }
.muted { color: #64748b; }
.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 14px 0; }
.meta-grid div { border-left: 3px solid #e2e8f0; padding-left: 10px; }
.meta-grid b { display: block; font-size: 12px; color: #64748b; font-weight: 600; }
.warn { padding: 10px 14px; border-radius: 8px; background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; margin: 12px 0; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
.kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
.kpi b { display: block; font-size: 22px; }
.kpi span { font-size: 12px; color: #64748b; }
.chart { width: 100%; height: auto; }
.chart .lb { font-size: 13px; fill: #0f172a; } .chart .nb { font-size: 12px; fill: #475569; } .chart .lg { font-size: 11px; fill: #475569; }
.round { page-break-inside: auto; }
.fact, .act { display: grid; grid-template-columns: 52px 92px 1fr; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
.time { font-variant-numeric: tabular-nums; color: #475569; }
.kind { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; }
.act .kind { color: #2563eb; }
.dec { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin: 10px 0; page-break-inside: avoid; }
.dec-h { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.did { font-weight: 800; }
.q { font-weight: 700; flex: 1; }
.dec p { margin: 6px 0; }
.meta { font-size: 12px; color: #64748b; margin-top: 2px !important; }
.whynot { color: #9a3412; } .ref { border-left: 3px solid #16a34a; padding-left: 10px; } .why { color: #334155; }
.tag { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.t-ok { background: #dcfce7; color: #166534; } .t-dev { background: #fef3c7; color: #92400e; } .t-high { background: #fee2e2; color: #991b1b; } .t-none { background: #f1f5f9; color: #475569; }
.recg { border-left: 4px solid #f59e0b; padding: 2px 14px 6px; margin: 14px 0; page-break-inside: avoid; }
.recg.sev-high { border-left-color: #dc2626; } .recg.sev-low { border-left-color: #94a3b8; }
.recg h4 { display: flex; gap: 10px; align-items: center; margin: 8px 0 6px; }
.recg .todo { margin: 4px 0; font-weight: 600; }
.recg .evid { margin: 8px 0 2px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.recg ul { margin: 0; padding-left: 18px; color: #334155; font-size: 13px; }
.recg li { margin: 3px 0; }
.notes { white-space: pre-wrap; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
.annex { font-size: 12px; color: #475569; }
.annex li { word-break: break-all; }
footer { margin-top: 30px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
@media (max-width: 640px) { .kpis { grid-template-columns: 1fr 1fr; } .meta-grid { grid-template-columns: 1fr; } .fact, .act { grid-template-columns: 46px 1fr; } .fact .kind, .act .kind { display: none; } }
</style></head>
<body><div class="page">
<div class="band"></div>
<p class="kicker">Informe del simulacro${org ? ` · ${esc(org)}` : ''}</p>
<h1>${esc(name)}</h1>
<p class="muted">Sesión ${esc(result.session_id)} · ${esc(fecha(result.started_at))}</p>
<div class="meta-grid">
  <div><b>Fecha y hora</b>${esc(fecha(result.started_at))}, ${hhmm(result.started_at)} – ${hhmm(result.completed_at)}</div>
  <div><b>Duración</b>${dur(result.started_at, result.completed_at)}</div>
  <div><b>Roles y participantes</b><ul style="margin:2px 0 0;padding-left:18px">${people}</ul></div>
  <div><b>Ejercicio</b>${esc(result.exercise?.id)} v${esc(result.exercise?.version)} · ${rounds.length || '—'} rondas · ${s.decisions} decisiones</div>
</div>
${result.answer_sheet_status === 'propuesta' ? '<p class="warn">La hoja de respuestas de este ejercicio es una <b>propuesta</b> pendiente de validar: las valoraciones son una guía para la conversación, no un veredicto.</p>' : ''}

<h2>Resumen</h2>
<div class="kpis">
  <div class="kpi"><b>${s.expected} / ${s.evaluated}</b><span>decisiones como la referencia</span></div>
  <div class="kpi"><b>${s.high_deviations}</b><span>desviaciones graves</span></div>
  <div class="kpi"><b>${s.discrepancies}</b><span>discrepancias entre visores</span></div>
  <div class="kpi"><b>${s.unanswered}</b><span>sin respuesta</span></div>
</div>
<p>El equipo coincidió con la respuesta de referencia en ${s.expected} de ${s.evaluated} decisiones${s.pct != null ? ` (${s.pct} %)` : ''}. ${esc(weakTxt)}</p>

<h2>Resultado por competencias</h2>
<p class="muted">El resultado se lee por competencia, no como una nota global.</p>
${competencyChart(result.capabilities)}

<h2>Cronología del ejercicio</h2>
<p class="muted">Hechos que recibió el equipo, actuaciones en el Panel de Crisis y decisiones, con la respuesta de referencia y, cuando hubo desviación, por qué la opción elegida no era la mejor.</p>
${roundBlocks}

<h2>Recomendaciones</h2>
<p class="muted">Acciones de mejora por competencia, ordenadas por prioridad, con las decisiones del ejercicio que las justifican.</p>
${recHtml}

${notes ? `<h2>Observaciones del facilitador</h2><div class="notes">${esc(notes)}</div>` : ''}

<h2>Anexo · Integridad de los registros</h2>
<ul class="annex">${(result.sources || []).map((x) => `<li>${esc(x.role)} · ${esc(x.file)} · ${esc(CHAIN[x.chain] || x.chain || '—')}${x.chain_head ? ` · huella ${esc(x.chain_head.slice(0, 12))}` : ''}</li>`).join('')}</ul>
<footer>Generado el ${esc(fecha(generatedAt))} a las ${hhmm(generatedAt)} con el kit de simulacros de continuidad. Contenido ficticio de ejercicio.</footer>
</div></body></html>`;
}
