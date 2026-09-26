// Catálogo del copiloto: JSON incluido en la app o, si se ha importado, hojas publicadas de Google Sheets (CSV).
// La importación se guarda en el navegador, así que el ejercicio sigue funcionando sin conexión.

const KEY = 'copiloto:catalogo';
const SHEETS_KEY = 'copiloto:sheets';

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo leer ${url} (${res.status})`);
  return res.json();
}

export async function loadDataset(base = 'data/') {
  const [config, services, scenarios, estrategias] = await Promise.all(
    ['config.json', 'servicios.json', 'escenarios.json', 'estrategias.json'].map((f) => getJSON(base + f)),
  );
  const ds = { config, services, scenarios, estrategias, source: 'Catálogo incluido (ficticio)' };
  try {
    const override = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (override && override.services && override.services.length) {
      Object.assign(ds, { services: override.services, scenarios: override.scenarios, estrategias: override.estrategias,
        source: `Google Sheets · importado ${new Date(override.loadedAt).toLocaleString('es-ES')}` });
    }
  } catch { /* sin almacenamiento */ }
  return ds;
}

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const REQUIRED = {
  servicios: ['idactivo', 'codigo', 'nombre', 'rto', 'mtpd', 'rpo', 'perdidah', 'impactoreputacional', 'n_responsable', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
  escenarios: ['codigo', 'nombre', 'tipo_calculo', 'activo', 'nivel_base', 'nivel_comite', 'umbral_prob_servicio', 'categoria_1', 'categoria_2', 'categoria_3'],
  estrategias: ['escenario', 'codigo', 'nombre', 'descripcion'],
};

async function fetchSheet(name, url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Hoja «${name}»: error ${res.status}`);
  const rows = parseCSV(await res.text());
  const missing = REQUIRED[name].filter((k) => !rows.length || !(k in rows[0]));
  if (missing.length) throw new Error(`Hoja «${name}»: faltan columnas ${missing.join(', ')}`);
  return rows;
}

export function getSheetUrls(config) {
  try { return { ...(config.sheets || {}), ...JSON.parse(localStorage.getItem(SHEETS_KEY) || '{}') }; } catch { return { ...(config.sheets || {}) }; }
}

export async function importFromSheets(urls) {
  const [services, scenarios, estRows] = await Promise.all([
    fetchSheet('servicios', urls.servicios), fetchSheet('escenarios', urls.escenarios), fetchSheet('estrategias', urls.estrategias),
  ]);
  const estrategias = {};
  for (const r of estRows) {
    const esc = r.escenario.toUpperCase();
    (estrategias[esc] = estrategias[esc] || []).push({ id: r.id || r.codigo, codigo: r.codigo, nombre: r.nombre, descripcion: r.descripcion });
  }
  localStorage.setItem(SHEETS_KEY, JSON.stringify(urls));
  localStorage.setItem(KEY, JSON.stringify({ services, scenarios, estrategias, loadedAt: Date.now() }));
  return { services: services.length, scenarios: scenarios.length };
}

export function clearImported() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}
