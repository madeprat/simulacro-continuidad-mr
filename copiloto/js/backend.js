// Backend local del copiloto: reproduce las acciones del servidor original (contexto, activar,
// cambiar estado y ajustar hora de inicio) guardando las activaciones en el navegador.
// No hay base de datos: el historial vive en localStorage y se puede exportar a CSV desde la pestaña Historial.

const KEY = 'copiloto:activaciones';

const iso = (ms) => new Date(ms).toISOString();
const normCodes = (codes) => [...new Set((codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
const fail = (mensaje) => ({ success: false, data: { mensaje } });

export function createBackend({ dataset, clock }) {
  const config = dataset.config || {};
  const operator = config.operator_label || 'Operador del panel';

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { seq: 0, rows: [] }; } catch { return { seq: 0, rows: [] }; }
  };
  const save = (db) => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ }
  };
  const history = (db) => [...db.rows].sort((a, b) => b.id - a.id).slice(0, Math.max(1, parseInt(config.history_limit || 20, 10)));
  const last = (db) => db.rows.filter((r) => r.status === 'active').sort((a, b) => b.id - a.id)[0] || history(db)[0] || null;
  const closeStale = (db, keepId, now) => {
    for (const r of db.rows) {
      if (r.status === 'active' && r.id !== keepId) {
        r.status = 'closed';
        r.closed_at_gmt = r.closed_at_gmt || iso(now);
        r.disaster_reason = r.disaster_reason || 'auto_closed_previous_active';
      }
    }
  };
  const allowedCodes = () => {
    const rows = dataset.scenarios || [];
    if (rows.length) return normCodes(rows.filter((r) => String(r.activo ?? '1') !== '0').map((r) => r.codigo));
    return normCodes(Object.keys(config.scenarios || {}));
  };
  const newRow = (db, fields) => ({
    id: ++db.seq, user_login: operator, created_by_user_login: operator, updated_by_user_login: '', contained_by_user_login: '',
    closed_by_user_login: '', disaster_by_user_login: '', scenarios: [], categories: {}, status: 'active',
    created_at_gmt: '', onset_at_gmt: '', contained_at_gmt: '', closed_at_gmt: '', disaster_at_gmt: '', disaster_reason: '',
    loss_total: 0, paused_total_seconds: 0, ...fields,
  });

  const actions = {
    context() {
      const db = load();
      return { rows: dataset.services || [], scenarios: dataset.scenarios || [], estrategias: dataset.estrategias || {}, lastActivation: last(db), history: history(db) };
    },

    activate({ scenarios, categories = {} }) {
      const valid = normCodes(scenarios).filter((c) => allowedCodes().includes(c));
      if (!valid.length) return fail('Selecciona al menos un escenario activo y válido para analizar el incidente.');
      const db = load();
      const now = clock.now();
      const active = db.rows.filter((r) => r.status === 'active').sort((a, b) => b.id - a.id)[0];
      if (active) {
        active.scenarios = normCodes([...active.scenarios, ...valid]);
        active.categories = { ...active.categories, ...categories };
        active.updated_by_user_login = operator;
        closeStale(db, active.id, now);
      } else {
        const row = newRow(db, { scenarios: valid, categories: { ...categories }, created_at_gmt: iso(now) });
        db.rows.push(row);
        closeStale(db, row.id, now);
      }
      save(db);
      return { ok: true, activation: last(db), history: history(db) };
    },

    status({ activation_id, status_action, loss_total, reason = '' }) {
      const db = load();
      const row = db.rows.find((r) => r.id === parseInt(activation_id, 10));
      if (!row) return fail('La activación indicada no existe.');
      const can = {
        contain: row.status === 'active',
        resume: row.status === 'contained',
        close: row.status === 'active' || row.status === 'contained',
        disaster: row.status !== 'closed',
      }[status_action];
      if (!can) return fail('La acción no es válida para el estado actual del incidente.');
      const now = clock.now();
      row.loss_total = parseFloat(loss_total) || 0;
      if (status_action === 'contain') {
        Object.assign(row, { status: 'contained', contained_at_gmt: iso(now), contained_by_user_login: operator });
      } else if (status_action === 'resume') {
        const delta = row.contained_at_gmt ? Math.max(0, Math.floor((now - Date.parse(row.contained_at_gmt)) / 1000)) : 0;
        Object.assign(row, { status: 'active', contained_at_gmt: '', paused_total_seconds: (row.paused_total_seconds || 0) + delta, updated_by_user_login: operator });
      } else if (status_action === 'close') {
        Object.assign(row, { status: 'closed', closed_at_gmt: iso(now), disaster_reason: reason, closed_by_user_login: operator });
      } else {
        Object.assign(row, { disaster_at_gmt: iso(now), disaster_reason: reason || 'threshold', disaster_by_user_login: operator });
      }
      save(db);
      return { ok: true, activation: row, history: history(db) };
    },

    set_onset({ activation_id, onset_gmt }) {
      const db = load();
      const row = db.rows.find((r) => r.id === parseInt(activation_id, 10));
      if (!row || !onset_gmt) return { ok: false, message: 'Datos insuficientes para ajustar la hora de inicio.' };
      const ts = Date.parse(String(onset_gmt).replace(' ', 'T') + 'Z');
      if (!isFinite(ts)) return { ok: false, message: 'Formato de fecha/hora no reconocido.' };
      if (ts > clock.now()) return { ok: false, message: 'La hora de inicio no puede ser en el futuro.' };
      row.onset_at_gmt = iso(ts);
      row.updated_by_user_login = operator;
      save(db);
      return { ok: true, onset_gmt: row.onset_at_gmt, activation: row };
    },
  };

  return {
    call(action, payload) {
      const fn = actions[action];
      return Promise.resolve(fn ? fn(payload || {}) : fail('Acción desconocida: ' + action));
    },
    // Modo ejercicio: fija el estado del incidente al de una ronda del pack.
    applyExerciseState({ scenarios = {}, createdMs, onsetMs, status = 'active' }) {
      const db = load();
      const now = clock.now();
      closeStale(db, -1, now);
      for (const r of db.rows) if (r.status === 'contained') Object.assign(r, { status: 'closed', closed_at_gmt: iso(now) });
      const codes = normCodes(Object.keys(scenarios));
      if (codes.length) {
        db.rows.push(newRow(db, {
          scenarios: codes, categories: { ...scenarios }, status, created_at_gmt: iso(createdMs ?? now),
          onset_at_gmt: onsetMs != null ? iso(onsetMs) : '', created_by_user_login: 'Ejercicio', user_login: 'Ejercicio',
        }));
      }
      save(db);
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
    },
  };
}
