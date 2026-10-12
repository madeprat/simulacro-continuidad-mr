// Pruebas de integridad y robustez: cadena del registro, estado compartido, CSV, catálogo y validación del pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { sha256Hex, eventHash, verifyLog, shortPrint } from '../js/integrity.js';
import { newerRev, validShared, mergeShared } from '../js/shared-state.js';
import { csvCell } from '../js/csv.js';
import { validatePack } from '../js/pack.js';
import { catalogFingerprint } from '../copiloto/js/core.js';
import { validateLogs } from '../debrief/consolidar.js';

test('SHA-256 propio coincide con el de Node', () => {
  for (const t of ['', 'abc', 'Crítico · €/h · ñ'.repeat(40), 'x'.repeat(5000)]) {
    assert.equal(sha256Hex(t), crypto.createHash('sha256').update(t).digest('hex'));
  }
});

const chained = () => {
  const events = [];
  let prev = '';
  for (const [i, ev] of [
    { type: 'session_started' },
    { type: 'decision_answered', decision_id: 'D1', answer: 'B', answer_source: 'own' },
    { type: 'panel_analyzed', scenarios: { E3: 1, E6: 2 } },
  ].entries()) {
    const e = { seq: i + 1, at: `2026-10-12T10:0${i}:00.000Z`, ...ev };
    e.hash = eventHash(prev, e);
    prev = e.hash;
    events.push(e);
  }
  return { events, decisions: { D1: { decision_id: 'D1', answer: 'B', answer_source: 'own' } }, integrity: { head: prev } };
};

test('la cadena del registro detecta cambios en eventos y decisiones', () => {
  const ok = chained();
  assert.equal(verifyLog(ok).status, 'integro');
  assert.equal(verifyLog(JSON.parse(JSON.stringify(ok))).status, 'integro', 'sobrevive a exportar e importar el JSON');

  const evento = structuredClone(ok); evento.events[1].answer = 'C';
  assert.equal(verifyLog(evento).status, 'alterado');
  assert.equal(verifyLog(evento).brokenAt, 2);

  const decision = structuredClone(ok); decision.decisions.D1.answer = 'C';
  assert.equal(verifyLog(decision).status, 'alterado');

  const quitado = structuredClone(ok); quitado.events.splice(1, 1);
  assert.equal(verifyLog(quitado).status, 'alterado');

  assert.equal(verifyLog({ events: [{ seq: 1, type: 'x' }], decisions: {} }).status, 'sin_cadena');
  assert.equal(shortPrint('a3f912c87b40ffff'), 'a3f9 12c8 7b40');
});

test('estado compartido: reloj lógico y fusión por campos', () => {
  assert.ok(newerRev({ n: 5, by: 'a' }, { n: 4, by: 'z' }));
  assert.ok(newerRev({ n: 4, by: 'b' }, { n: 4, by: 'a' }), 'empate: desempata el id');
  assert.ok(!newerRev(null, { n: 1, by: 'a' }));

  const base = { roundId: 'R01', simNow: 1000, selected: { E3: 1 }, act: null, sent: {}, convened: null };
  const local = { ...base, rev: { n: 3, by: 'r2' }, selected: { E3: 2 }, sent: {} };
  // R3 marca una comunicación con una versión anterior (operaciones casi simultáneas).
  const incoming = { ...base, rev: { n: 2, by: 'r3' }, sent: { 'priv-2': 500 } };
  const m = mergeShared(local, incoming);
  assert.equal(m.incomingWins, false);
  assert.deepEqual(m.state.selected, { E3: 2 }, 'se conserva el cambio de categoría más reciente');
  assert.deepEqual(m.state.sent, { 'priv-2': 500 }, 'y no se pierde la comunicación notificada');
  assert.ok(m.changed);

  const nuevo = mergeShared(local, { ...base, rev: { n: 9, by: 'r1' }, selected: { E6: 3 }, convened: 700 });
  assert.equal(nuevo.incomingWins, true);
  assert.deepEqual(nuevo.state.selected, { E6: 3 });
  assert.equal(nuevo.state.convened, 700);

  assert.equal(mergeShared(local, { ...local }).changed, false);
});

test('estado compartido: se rechazan mensajes mal formados', () => {
  const ok = { rev: { n: 1, by: 'x' }, simNow: 1, selected: { E3: 1 }, act: { scenarios: { E3: 1 }, status: 'active' }, sent: {}, convened: null };
  assert.ok(validShared(ok));
  assert.ok(!validShared({ ...ok, rev: { n: 'uno', by: 'x' } }));
  assert.ok(!validShared({ ...ok, selected: { E3: 7 } }));
  assert.ok(!validShared({ ...ok, selected: { '<img>': 1 } }));
  assert.ok(!validShared({ ...ok, act: { scenarios: { E3: 1 }, status: 'hackeado' } }));
  assert.ok(!validShared({ ...ok, sent: { 'seg-1': 'ayer' } }));
  assert.ok(!validShared(null));
});

test('CSV: comillas y protección frente a fórmulas', () => {
  assert.equal(csvCell('texto'), 'texto');
  assert.equal(csvCell('a, b'), '"a, b"');
  assert.equal(csvCell('dijo "sí"'), '"dijo ""sí"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+34 600'), "'+34 600");
  assert.equal(csvCell('-12,5'), '"-12,5"', 'los números negativos no se tocan');
  assert.equal(csvCell(null), '');
});

test('la huella del catálogo es la misma en la TV y en las gafas y cambia con los datos', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL('../copiloto/data/' + f, import.meta.url)));
  const data = { config: read('config.json'), services: read('servicios.json'), scenarios: read('escenarios.json'), estrategias: read('estrategias.json') };
  const a = catalogFingerprint(data, sha256Hex);
  assert.equal(a.length, 12);
  assert.equal(catalogFingerprint(JSON.parse(JSON.stringify(data)), sha256Hex), a);
  const otro = structuredClone(data); otro.services[0].perdidah = '1.500 €';
  assert.notEqual(catalogFingerprint(otro, sha256Hex), a);

  const log = (role, fp) => ({ name: role + '.json', data: { schema: 'crisis.session/1.0', exercise: { id: 'X', version: '1' }, session_id: 's', local_role: role, completed_at: 'x', catalog_fingerprint: fp } });
  assert.ok(validateLogs([log('R1', 'aaa'), log('R2', 'bbb')]).warnings.some((w) => w.includes('catálogos distintos')));
  assert.ok(!validateLogs([log('R1', 'aaa'), log('R2', 'aaa')]).warnings.some((w) => w.includes('catálogos distintos')));
});

test('la validación del pack detecta errores en el estado del copiloto, pestañas y hoja de respuestas', () => {
  const pack = {
    manifest: { schema: 'crisis.exercise/1.0', exercise_id: 'T', version: '1' },
    roles: [{ id: 'R1', name: 'R1' }],
    rounds: [{
      id: 'R01', number: 1,
      copilot: { clock: '7:33', scenarios: { E3: 5, X: 1 } },
      panel_actions: [{ id: 'A1', tab: 'Pestaña inventada', text: 't' }],
      decisions: [{ id: 'D1', role: 'R1', question: 'q', answers: ['A', 'B', 'C', 'D'].map((id) => ({ id, text: id })) }],
    }],
    debrief: { capabilities: { roles: 'Roles' }, assessments: { D1: { preferred_response: 'A', severity_if_missed: 'enorme', capability: 'otra' } } },
  };
  const errors = validatePack(pack).join('\n');
  for (const frag of ['copilot.clock', 'categoría de E3', '«X» no válido', 'pestaña del panel desconocida', 'gravedad «enorme»', 'capacidad «otra»']) {
    assert.ok(errors.includes(frag), `falta el error: ${frag}\n${errors}`);
  }
});

test('el service worker precarga todos los ficheros de la aplicación', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = [...sw.matchAll(/'([^']+\.(?:js|css|html|json|webmanifest))'/g)].map((m) => m[1]);
  const root = new URL('../', import.meta.url);
  for (const f of listed) assert.ok(fs.existsSync(new URL(f, root)), `${f} está en la precarga pero no existe`);
  const walk = (dir) => fs.readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(dir + d.name + '/') : [dir + d.name]);
  const app = ['js/', 'css/', 'debrief/', 'copiloto/js/', 'copiloto/css/', 'copiloto/docs/', 'packs/']
    .flatMap(walk).filter((f) => /\.(js|css|html|json)$/.test(f));
  for (const f of app) assert.ok(listed.includes(f), `${f} no está en la precarga del service worker`);
});
