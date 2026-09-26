// Interfaz del consolidador de debrief.
import { consolidate, validateLogs, toCSV, sha256 } from './consolidar.js';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const row = (cells) => { const tr = document.createElement('tr'); for (const c of cells) tr.append(c instanceof Node ? (() => { const td = document.createElement('td'); td.append(c); return td; })() : el('td', c ?? '—')); return tr; };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES') : '—');
const STATUS = { ok: 'ok', discrepancia: 'discrepancia', sin_fuente_propia: 'sin fuente propia', sin_respuesta: 'sin respuesta' };

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
  if (!pack) msgs.append(el('p', 'No se encontró el pack del ejercicio: se consolida sin textos de las preguntas.', 'warn'));
  current = { result: consolidate(logs, pack), logs };
  current.result.sources = logs.map((l) => ({ file: l.name, role: l.data.local_role, sha256: l.hash }));
  current.result.generated_at = new Date().toISOString();
  render();
}

function render() {
  const { result: r } = current;
  $('result').hidden = false;
  $('res-title').textContent = `${r.exercise?.id} v${r.exercise?.version} · Sesión ${r.session_id} · Roles ${r.roles_loaded.join(', ')}`;
  const s = r.summary;
  const stats = [
    ['Decisiones con respuesta', `${s.decisions_with_answer} / ${s.decisions_total}`],
    ['Con fuente propia', String(s.decisions_own_source)],
    ['Discrepancias', String(s.discrepancies)],
    ['Sin fuente propia', String(s.without_own_source)],
    ['Sin respuesta', String(s.unanswered)],
  ];
  $('stats').replaceChildren(...stats.map(([k, v]) => { const d = el('div', null, 'stat'); d.append(el('b', v), el('span', k)); return d; }));

  $('roles').replaceChildren(...Object.entries(r.per_role).map(([role, p]) => row([role, p.file, String(p.own_decisions),
    p.avg_response_seconds != null ? `${p.avg_response_seconds} s` : '—', p.max_response_seconds != null ? `${p.max_response_seconds} s` : '—',
    String(p.panel_actions_confirmed), String(p.corrections)])));

  const head = document.createElement('tr');
  for (const h of ['Ronda', 'Decisión', 'Rol', 'Pregunta', 'Resp.', 'Tiempo', ...r.roles_loaded.map((x) => `Obs. ${x}`), 'Estado', 'Valoración']) head.append(el('th', h));
  $('dec-head').replaceChildren(head);
  $('decisions').replaceChildren(...r.decisions.map((d) => {
    const tag = el('span', STATUS[d.status], `tag tag-${d.status}`);
    const tr = row([d.round_id, d.decision_id, d.active_role, d.question, d.answer || '—', d.response_seconds != null ? `${d.response_seconds} s` : '—',
      ...r.roles_loaded.map((x) => (x === d.active_role ? '·' : d.observed[x] || '—')), tag, d.reference_rating.replace('_', ' ')]);
    tr.children[3].className = 'q';
    return tr;
  }));
  $('timeline').replaceChildren(...r.timeline.map((t) => row([fmtTime(t.at), t.role, t.detail])));
  $('hashes').replaceChildren(...r.sources.map((x) => el('li', `${x.role} · ${x.file} · SHA-256 ${x.sha256 || 'no disponible'}`)));
}

$('files').addEventListener('change', (e) => handleFiles(e.target.files));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
$('btn-json').addEventListener('click', () => download(`${current.result.exercise.id}_${current.result.session_id}_consolidado.json`, JSON.stringify(current.result, null, 2), 'application/json'));
$('btn-csv').addEventListener('click', () => download(`${current.result.exercise.id}_${current.result.session_id}_consolidado.csv`, toCSV(current.result), 'text/csv;charset=utf-8'));
$('btn-print').addEventListener('click', () => window.print());
