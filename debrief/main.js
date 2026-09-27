// Interfaz del consolidador de debrief.
import { consolidate, validateLogs, toCSV, findingsCSV, sha256 } from './consolidar.js';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const row = (cells) => { const tr = document.createElement('tr'); for (const c of cells) tr.append(c instanceof Node ? (() => { const td = document.createElement('td'); td.append(c); return td; })() : el('td', c ?? '—')); return tr; };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES') : '—');
const secs = (v) => (v != null ? `${v} s` : '—');
const STATUS = { ok: 'ok', discrepancia: 'discrepancia', sin_fuente_propia: 'sin fuente propia', sin_respuesta: 'sin respuesta' };
const RATING = { esperada: 'esperada', desviacion: 'desviación', no_evaluada: 'no evaluada' };
const CAP_STATUS = { adecuada: 'adecuada', revisar: 'revisar', mejorar: 'mejorar', sin_datos: 'sin datos' };
const SEVERITY = { high: 'alta', medium: 'media', low: 'baja' };

let current = null;

function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function loadPack(exerciseId) {
  try {
    const idx = await (await fetch('../packs/index.json')).json();
    for (const p of idx.packs) {
      const base = new URL('../' + p.path, location.href);
      const manifest = await (await fetch(new URL('manifest.json', base))).json();
      if (manifest.exercise_id !== exerciseId) continue;
      const files = manifest.files || {};
      const rounds = (await (await fetch(new URL(files.rounds || 'rounds.json', base))).json()).rounds;
      const debrief = files.debrief ? await (await fetch(new URL(files.debrief, base))).json().catch(() => ({})) : {};
      return { manifest, rounds, debrief };
    }
  } catch { /* sin pack: se consolida igualmente con lo que traen los registros */ }
  return null;
}

/* ─────────────── Hallazgos editables (guardados en el navegador) ─────────────── */

const storeKey = () => `debrief:${current.result.exercise?.id}:${current.result.session_id}`;

function loadEdits() {
  try { return JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch { return null; }
}

function saveEdits() {
  try { localStorage.setItem(storeKey(), JSON.stringify({ findings: current.findings, notes: current.notes })); } catch { /* sin almacenamiento */ }
  current.result.findings = current.findings.filter((f) => f.include);
  current.result.facilitator_notes = current.notes;
}

function renderFindings() {
  const wrap = $('findings');
  if (!current.findings.length) { wrap.replaceChildren(el('p', 'Sin hallazgos propuestos: todas las decisiones coinciden con la referencia.', 'muted')); return; }
  wrap.replaceChildren(...current.findings.map((f, i) => {
    const card = el('div', null, `finding sev-${f.severity}${f.include ? '' : ' excluded'}`);
    const head = el('div', null, 'finding-head');
    const inc = Object.assign(document.createElement('input'), { type: 'checkbox', checked: f.include });
    inc.addEventListener('change', () => { f.include = inc.checked; card.classList.toggle('excluded', !f.include); saveEdits(); });
    const sev = document.createElement('select');
    for (const [k, v] of Object.entries(SEVERITY)) sev.append(Object.assign(document.createElement('option'), { value: k, textContent: 'Gravedad ' + v, selected: f.severity === k }));
    sev.addEventListener('change', () => { f.severity = sev.value; card.className = `finding sev-${f.severity}${f.include ? '' : ' excluded'}`; saveEdits(); });
    const incLabel = el('label', null, 'inc');
    incLabel.append(inc, document.createTextNode(' Incluir'));
    head.append(incLabel, el('span', f.capability || 'General', 'cap'), sev);
    const field = (label, key, multiline = false, type = 'text') => {
      const lab = el('label', null, 'ffield');
      const input = multiline ? document.createElement('textarea') : Object.assign(document.createElement('input'), { type });
      input.value = f[key] || '';
      if (multiline) input.rows = 3;
      input.addEventListener('input', () => { f[key] = input.value; saveEdits(); });
      lab.append(el('span', label), input);
      return lab;
    };
    const grid = el('div', null, 'finding-grid');
    grid.append(field('Hallazgo', 'text', true), field('Acción de mejora', 'action', true), field('Responsable', 'owner'), field('Plazo', 'due', false, 'date'));
    card.append(head, grid);
    card.dataset.index = i;
    return card;
  }));
}

/* ─────────────── Carga y pintado ─────────────── */

async function handleFiles(fileList) {
  const msgs = $('messages');
  msgs.replaceChildren();
  const logs = [];
  for (const f of fileList) {
    const text = await f.text();
    try { logs.push({ name: f.name, text, data: JSON.parse(text), hash: await sha256(text) }); }
    catch { msgs.append(el('p', `${f.name}: no es un JSON válido.`, 'error')); }
  }
  const { errors, warnings } = validateLogs(logs);
  for (const e of errors) msgs.append(el('p', e, 'error'));
  for (const w of warnings) msgs.append(el('p', w, 'warn'));
  if (errors.length) { $('result').hidden = true; return; }
  const pack = await loadPack(logs[0].data.exercise?.id);
  if (!pack) msgs.append(el('p', 'No se encontró el pack del ejercicio: se consolida sin textos ni hoja de respuestas.', 'warn'));
  const result = consolidate(logs, pack);
  result.sources = logs.map((l) => ({ file: l.name, role: l.data.local_role, sha256: l.hash }));
  result.generated_at = new Date().toISOString();
  current = { result, logs };
  const edits = loadEdits();
  current.findings = edits ? edits.findings : result.suggested_findings.map((f) => ({ ...f, include: true, owner: '', due: '' }));
  current.notes = edits ? edits.notes : '';
  saveEdits();
  render();
}

function render() {
  const { result: r } = current;
  $('result').hidden = false;
  $('res-title').textContent = `${r.exercise?.id} v${r.exercise?.version} · Sesión ${r.session_id} · Roles ${r.roles_loaded.join(', ')}`;
  $('sheet-warning').hidden = r.answer_sheet_status !== 'propuesta';
  const s = r.summary;
  const evaluated = r.decisions.filter((d) => d.reference_rating !== 'no_evaluada');
  const expected = evaluated.filter((d) => d.reference_rating === 'esperada').length;
  const stats = [
    ['Decisiones con respuesta', `${s.decisions_with_answer} / ${s.decisions_total}`],
    ['Coinciden con la referencia', evaluated.length ? `${expected} / ${evaluated.length}` : '—'],
    ['Desviaciones graves', String(r.decisions.filter((d) => d.reference_rating === 'desviacion' && d.severity_if_missed === 'high').length)],
    ['Discrepancias entre visores', String(s.discrepancies)],
    ['Sin respuesta', String(s.unanswered)],
  ];
  $('stats').replaceChildren(...stats.map(([k, v]) => { const d = el('div', null, 'stat'); d.append(el('b', v), el('span', k)); return d; }));

  $('caps').replaceChildren(...r.capabilities.map((c) => row([c.label, String(c.total), c.answered ? `${c.expected} (${c.expected_pct}%)` : '—',
    String(c.deviations), String(c.high_deviations), secs(c.avg_response_seconds), el('span', CAP_STATUS[c.status], `tag cap-${c.status}`)])));

  renderFindings();
  $('notes').value = current.notes;

  const head = document.createElement('tr');
  for (const h of ['Ronda', 'Decisión', 'Rol', 'Pregunta', 'Resp.', 'Ref.', 'Tiempo', ...r.roles_loaded.map((x) => `Obs. ${x}`), 'Estado', 'Valoración']) head.append(el('th', h));
  $('dec-head').replaceChildren(head);
  $('decisions').replaceChildren(...r.decisions.map((d) => {
    const q = document.createElement('div');
    q.append(el('div', d.question));
    if (d.reference_rating === 'desviacion' && d.rationale) q.append(el('small', d.rationale, 'rationale'));
    const rating = el('span', RATING[d.reference_rating] + (d.reference_rating === 'desviacion' ? ` · ${SEVERITY[d.severity_if_missed] || ''}` : ''), `tag rating-${d.reference_rating}`);
    const tr = row([d.round_id, d.decision_id, d.active_role, q, (d.answer || '—') + (d.sync_from ? ' 🔗' : ''), d.preferred_response || '—', secs(d.response_seconds),
      ...r.roles_loaded.map((x) => (x === d.active_role ? '·' : d.observed[x] || '—')), el('span', STATUS[d.status], `tag tag-${d.status}`), rating]);
    tr.children[3].className = 'q';
    return tr;
  }));

  $('roles').replaceChildren(...Object.entries(r.per_role).map(([role, p]) => row([role, p.file, String(p.own_decisions),
    secs(p.avg_response_seconds), secs(p.max_response_seconds), String(p.panel_actions_confirmed), String(p.corrections)])));
  $('panel').replaceChildren(...(r.panel_evidence.length ? r.panel_evidence.map((e) => row([fmtTime(e.at), e.round_id || '—', e.role, e.detail]))
    : [row(['—', '—', '—', 'Sin actuaciones registradas en el Panel de Crisis.'])]));
  $('timeline').replaceChildren(...r.timeline.map((t) => row([fmtTime(t.at), t.role, t.detail])));
  $('hashes').replaceChildren(...r.sources.map((x) => el('li', `${x.role} · ${x.file} · SHA-256 ${x.sha256 || 'no disponible'}`)));
}

$('files').addEventListener('change', (e) => handleFiles(e.target.files));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
$('notes').addEventListener('input', (e) => { current.notes = e.target.value; saveEdits(); });
$('btn-add-finding').addEventListener('click', () => {
  current.findings.push({ id: 'F-manual-' + Date.now(), capability: 'General', severity: 'medium', text: '', action: '', owner: '', due: '', include: true });
  saveEdits(); renderFindings();
});
const base = () => `${current.result.exercise.id}_${current.result.session_id}`;
$('btn-json').addEventListener('click', () => { saveEdits(); download(`${base()}_consolidado.json`, JSON.stringify(current.result, null, 2), 'application/json'); });
$('btn-csv').addEventListener('click', () => download(`${base()}_decisiones.csv`, toCSV(current.result), 'text/csv;charset=utf-8'));
$('btn-actions-csv').addEventListener('click', () => { saveEdits(); download(`${base()}_acciones_mejora.csv`, findingsCSV(current.result), 'text/csv;charset=utf-8'); });
$('btn-print').addEventListener('click', () => window.print());

// Gancho de pruebas automatizadas.
if (new URLSearchParams(location.search).has('debug')) window.__debrief = { get current() { return current; } };
