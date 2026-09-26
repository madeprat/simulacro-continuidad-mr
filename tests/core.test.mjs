// Pruebas del motor de cálculo del copiloto: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../copiloto/js/core.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL('../copiloto/data/' + p, import.meta.url)));
const data = { services: read('servicios.json'), scenarios: read('escenarios.json'), estrategias: read('estrategias.json'), config: read('config.json') };
const ctx = { scenarioRows: data.scenarios, estrategias: data.estrategias, config: data.config };

test('parseNum admite formatos español e inglés', () => {
  assert.equal(core.parseNum('1.234,56'), 1234.56);
  assert.equal(core.parseNum('1,234.56'), 1234.56);
  assert.equal(core.parseNum('0,25'), 0.25);
  assert.equal(core.parseNum(''), null);
});

test('probPct e impactTone', () => {
  assert.equal(core.probPct('Alta (75%)'), 75);
  assert.equal(core.probPct('Muy alta (100%)'), 100);
  assert.equal(core.probPct('Nula (0%)'), 0);
  assert.equal(core.impactTone('Crítico').cls, 'critical');
  assert.equal(core.impactTone('CRITICO').cls, 'critical');
  assert.equal(core.impactTone('Alto').cls, 'danger');
});

test('ejemplo de la ayuda del panel: E3 + 9 servicios + RTO 3 h + 2.200 €/h = 4,0 → N3', () => {
  const services = Array.from({ length: 9 }, (_, i) => ({
    idactivo: String(i), codigo: 'S' + i, rto: '3', mtpd: '24', rpo: '1', perdidah: String(2200 / 9),
    impactoreputacional: 'Medio', e3: 'Alta (75%)',
  }));
  const selected = { E3: 1 };
  const affected = core.computeAffectedServices(services, selected, ctx);
  assert.equal(affected.length, 9);
  const lvl = core.computeIncidentLevel({ selected, affected, elapsed: 0, lastLoss: 0, ctx });
  assert.equal(lvl.baseLevel, 2);
  assert.equal(lvl.score, 4);
  assert.equal(lvl.level, 3);
  assert.equal(lvl.hardTriggers.length, 0);
});

test('catálogo TRAMONTANA: E3 + E6 → 26 servicios, RTO 2 h, 8.809,82 €/h, N3', () => {
  const selected = { E3: 1, E6: 1 };
  const affected = core.computeAffectedServices(data.services, selected, ctx);
  assert.equal(affected.length, 26);
  const lvl = core.computeIncidentLevel({ selected, affected, elapsed: 0, lastLoss: 0, ctx });
  assert.equal(lvl.minRto, 2);
  assert.equal(Math.round(lvl.totalLossHour * 100) / 100, 8809.82);
  assert.equal(lvl.level, 3);
  assert.ok(lvl.committeeRecommended);
});

test('categoría 3 fuerza N3 por escalada automática', () => {
  const selected = { E5: 3 };
  const affected = core.computeAffectedServices(data.services, selected, ctx);
  const lvl = core.computeIncidentLevel({ selected, affected, elapsed: 0, lastLoss: 0, ctx });
  assert.equal(lvl.level, 3);
  assert.match(lvl.hardTriggers[0], /Categoría 3/);
});

test('condición de desastre al superar 5.000 € acumulados', () => {
  const affected = core.computeAffectedServices(data.services, { E3: 1, E6: 1 }, ctx);
  const before = core.computePressure(affected, 2000, data.config);
  const after = core.computePressure(affected, 2100, data.config);
  assert.equal(before.disaster, false);
  assert.equal(after.disaster, true);
  assert.equal(after.overallTone, 'ok');
  assert.equal(core.computePressure(affected, 3 * 3600, data.config).overallTone, 'danger');
});

test('estrategias: EST04 existe siempre y solo se activan las de los escenarios seleccionados', () => {
  const list = core.uniqueStrategies({ E6: 1 }, ctx);
  const est04 = list.find((s) => s.code === 'EST04');
  assert.ok(est04);
  assert.equal(est04.activeScenarios.length, 0);
  assert.deepEqual(list.find((s) => s.code === 'EST08').activeScenarios, ['E6']);
});

test('comunicaciones y cuenta atrás RGPD', () => {
  assert.equal(core.getCommsForCtx('privacidad').length, 3);
  const aepd = core.COMMS_TABLE.find((c) => c.id === 'priv-2');
  assert.equal(core.getCommsStatus(aepd, 60 * 70).key, 'due');
  assert.equal(core.getCommsStatus(aepd, 60 * 73).key, 'overdue');
  const r = core.rgpdCountdown(0, 3600000 * 61);
  assert.deepEqual([r.hours, r.cls], [11, 'danger']);
});

test('snapshot agrega todo para las gafas', () => {
  const onsetMs = Date.UTC(2026, 0, 1, 6, 2);
  const snap = core.snapshot(data, { selected: { E3: 1, E6: 2 }, onsetMs, nowMs: onsetMs + 91 * 60000, status: 'active' });
  assert.equal(snap.affected.length, 26);
  assert.equal(snap.level.level, 3);
  assert.ok(snap.pressure.disaster);
  assert.equal(snap.label.cls, 'critical');
});

test('tiempo de ejercicio y estado de ronda', () => {
  const base = core.exerciseBase(new Date(2026, 8, 27, 15, 0));
  assert.equal(core.exerciseTime('D1 01:05', base) - base, (24 * 60 + 65) * 60000);
  const st = core.roundCopilotState({ copilot: { clock: 'D0 07:33', declared: 'D0 07:08', onset: 'D0 06:02', scenarios: { E3: 1 } } }, base);
  assert.equal((st.nowMs - st.onsetMs) / 60000, 91);
  assert.deepEqual(st.selected, { E3: 1 });
  assert.equal(core.roundCopilotState({}, base), null);
});
