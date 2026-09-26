// Pruebas de la consolidación de registros de visores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidate, validateLogs, toCSV } from '../debrief/consolidar.js';

const log = (role, decisions, extra = {}) => ({
  name: `T_S1_${role}.json`,
  data: {
    schema: 'crisis.session/1.0', session_id: 'S1', exercise: { id: 'T', version: '1.0' }, local_role: role,
    started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T12:00:00Z', events: [], decisions, ...extra,
  },
});
const rec = (id, active, answer, source, secs = 10) => ({ round_id: 'R01', decision_id: id, active_role: active, answer, answer_source: source, response_seconds: secs });
const pack = { rounds: [{ id: 'R01', decisions: [{ id: 'D1', role: 'R1', question: '¿?' }, { id: 'D2', role: 'R2' }, { id: 'D3', role: 'R3' }] }], debrief: { assessments: { D1: { preferred_response: 'B' } } } };

test('usa el visor del rol activo como fuente y marca discrepancias', () => {
  const logs = [
    log('R1', { D1: rec('D1', 'R1', 'B', 'own', 12), D2: rec('D2', 'R2', 'C', 'observed') }),
    log('R2', { D1: rec('D1', 'R1', 'B', 'observed'), D2: rec('D2', 'R2', 'A', 'own', 30) }),
  ];
  assert.deepEqual(validateLogs(logs).errors, []);
  const r = consolidate(logs, pack);
  const [d1, d2, d3] = r.decisions;
  assert.equal(d1.answer, 'B'); assert.equal(d1.status, 'ok'); assert.equal(d1.reference_rating, 'esperada'); assert.equal(d1.response_seconds, 12);
  assert.equal(d2.answer, 'A'); assert.equal(d2.status, 'discrepancia'); assert.deepEqual(d2.observed, { R1: 'C' });
  assert.equal(d3.status, 'sin_respuesta');
  assert.equal(r.summary.discrepancies, 1);
  assert.equal(r.per_role.R2.avg_response_seconds, 30);
  assert.match(toCSV(r), /observed_R1,observed_R2/);
});

test('sin visor del rol activo se toma la respuesta observada', () => {
  const r = consolidate([log('R1', { D3: rec('D3', 'R3', 'D', 'observed') }), log('R2', { D3: rec('D3', 'R3', 'D', 'observed') })], pack);
  assert.equal(r.decisions[2].answer, 'D');
  assert.equal(r.decisions[2].status, 'sin_fuente_propia');
});

test('rechaza registros de sesiones distintas', () => {
  const a = log('R1', {});
  const b = log('R2', {});
  b.data.session_id = 'OTRA';
  assert.equal(validateLogs([a, b]).errors.length, 1);
});
