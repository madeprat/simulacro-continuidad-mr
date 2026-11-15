// Pruebas del protocolo de la consola del facilitador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSteps } from '../js/pack.js';
import { controlTargets, resolveTarget, controlMessage, acceptControl, peerName, FACILITATOR_ROLE, MESSAGE_MAX } from '../js/facilitator.js';

const readPack = (name) => {
  const base = new URL(`../packs/${name}/`, import.meta.url);
  const get = (f) => JSON.parse(fs.readFileSync(new URL(f, base)));
  const manifest = get('manifest.json');
  const files = manifest.files || {};
  return { manifest, roles: get(files.roles || 'roles.json').roles, rounds: get(files.rounds || 'rounds.json').rounds, debrief: {} };
};
const packNames = () => JSON.parse(fs.readFileSync(new URL('../packs/index.json', import.meta.url))).packs
  .map((p) => p.path.replace(/^packs\//, '').replace(/\/$/, ''));
const fromFac = (pack, action, extra) => ({ type: 'control', from: FACILITATOR_ROLE, data: controlMessage(pack, action, extra) });

test('cada punto lanzable de cada pack lleva a un paso del ejercicio', () => {
  for (const name of packNames()) {
    const pack = readPack(name);
    const steps = buildSteps(pack);
    const targets = controlTargets(pack);
    assert.equal(targets.filter((t) => t.kind === 'round').length, pack.rounds.length, name);
    for (const t of targets) {
      const i = resolveTarget(steps, t);
      assert.ok(i >= 0, `${name}: ${t.label}`);
      const s = steps[i];
      if (t.kind === 'round') assert.equal(s.kind, 'round_intro');
      if (t.kind === 'inject') assert.equal(s.event.id, t.inject_id);
      if (t.kind === 'end') assert.equal(s.kind, 'end');
    }
  }
});

test('un destino que no existe en el pack no mueve a nadie', () => {
  const pack = readPack('altamar');
  const steps = buildSteps(pack);
  assert.equal(resolveTarget(steps, { kind: 'round', round_id: 'R99' }), -1);
  assert.equal(resolveTarget(steps, { kind: 'inject', round_id: pack.rounds[0].id, inject_id: 'NO-EXISTE' }), -1);
  assert.equal(resolveTarget(steps, { kind: 'raro' }), -1);
  assert.equal(resolveTarget(steps, null), -1);
});

test('solo se aceptan órdenes del facilitador y del mismo ejercicio', () => {
  const pack = readPack('altamar');
  const other = readPack('tramontana');
  assert.deepEqual(acceptControl(pack, fromFac(pack, 'start'), 'R1'), { action: 'start' });
  assert.equal(acceptControl(pack, { ...fromFac(pack, 'start'), from: 'R2' }, 'R1'), null, 'un visor no puede dar órdenes');
  assert.equal(acceptControl(pack, fromFac(other, 'start'), 'R1'), null, 'otro ejercicio');
  assert.equal(acceptControl(pack, { type: 'control', from: FACILITATOR_ROLE, data: { action: 'borrar', exercise_id: pack.manifest.exercise_id } }, 'R1'), null);
  assert.equal(acceptControl(pack, { type: 'panel', from: FACILITATOR_ROLE, data: {} }, 'R1'), null);
  const go = acceptControl(pack, fromFac(pack, 'goto', { target: { kind: 'round', round_id: pack.rounds[1].id } }), 'R1');
  assert.deepEqual(go, { action: 'goto', target: { kind: 'round', round_id: pack.rounds[1].id } });
  assert.equal(acceptControl(pack, fromFac(pack, 'goto', { target: { kind: 'step', index: 3 } }), 'R1'), null);
});

test('avisos: recortados, no vacíos y solo para su destinatario', () => {
  const pack = readPack('altamar');
  const largo = 'x'.repeat(MESSAGE_MAX + 50);
  assert.equal(acceptControl(pack, fromFac(pack, 'message', { text: largo }), 'R1').text.length, MESSAGE_MAX);
  assert.equal(acceptControl(pack, fromFac(pack, 'message', { text: '   ' }), 'R1'), null);
  assert.deepEqual(acceptControl(pack, fromFac(pack, 'message', { text: 'Hola', to: 'R2' }), 'R2'), { action: 'message', text: 'Hola', to: 'R2' });
  assert.equal(acceptControl(pack, fromFac(pack, 'message', { text: 'Hola', to: 'R2' }), 'R1'), null);
  assert.equal(acceptControl(pack, fromFac(pack, 'message', { text: 'A todos' }), 'R3').to, 'ALL');
});

test('el facilitador aparece con nombre legible en la sala', () => {
  assert.equal(peerName(FACILITATOR_ROLE), 'Facilitador');
  assert.equal(peerName('R2'), 'R2');
});

test('registro de un visor: la consola acepta el suyo y rechaza los ajenos', async () => {
  const { Session } = await import('../js/session.js');
  const { acceptLog, logMessage } = await import('../js/facilitator.js');
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const pack = readPack('altamar');
  const s = new Session(pack, { sessionId: '20261115-ABC', role: 'R2' });
  s.start();
  s.complete();
  const data = logMessage(s);
  const ok = acceptLog(pack, { type: 'log', from: 'R2', data }, '20261115-abc');
  assert.ok(ok, 'el código de sesión no distingue mayúsculas');
  assert.equal(ok.role, 'R2');
  assert.equal(ok.completed, true);
  assert.equal(ok.head, s.head);
  assert.equal(ok.text, data.text, 'el texto llega intacto para que el debrief verifique la cadena');
  assert.equal(acceptLog(pack, { type: 'log', from: 'R1', data }, '20261115-ABC'), null, 'otro rol no puede enviar el registro de R2');
  assert.equal(acceptLog(pack, { type: 'log', from: 'R2', data }, 'OTRA-SESION'), null);
  assert.equal(acceptLog(readPack('siroco'), { type: 'log', from: 'R2', data }, '20261115-ABC'), null, 'otro ejercicio');
  assert.equal(acceptLog(pack, { type: 'log', from: 'R2', data: { ...data, text: '{roto' } }, '20261115-ABC'), null);
  // Un nombre de fichero con rutas se sustituye por uno seguro.
  assert.equal(acceptLog(pack, { type: 'log', from: 'R2', data: { ...data, file: '../../malo.json' } }, '20261115-ABC').file, 'ALTAMAR_20261115-ABC_R2.json');
});

test('la orden de recoger registros es válida', () => {
  const pack = readPack('altamar');
  assert.deepEqual(acceptControl(pack, fromFac(pack, 'collect'), 'R1'), { action: 'collect' });
});
