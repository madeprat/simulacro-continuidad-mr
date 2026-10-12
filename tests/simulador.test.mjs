// Pruebas del simulador: pack de ejemplo, centro de mando y decisiones sincronizadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePack, buildSteps, acceptRemoteAnswer } from '../js/pack.js';
import { slotPose, slotFor, angularWidth, SLOTS } from '../js/layout.js';
import { timelineFor } from '../js/command-bar.js';

const readPack = (name) => {
  const base = new URL(`../packs/${name}/`, import.meta.url);
  const get = (f) => JSON.parse(fs.readFileSync(new URL(f, base)));
  const manifest = get('manifest.json');
  const files = manifest.files || {};
  return {
    manifest, roles: get(files.roles || 'roles.json').roles, rounds: get(files.rounds || 'rounds.json').rounds,
    debrief: files.debrief ? get(files.debrief) : {},
  };
};

test('todos los packs del catálogo son válidos', () => {
  const index = JSON.parse(fs.readFileSync(new URL('../packs/index.json', import.meta.url)));
  for (const p of index.packs) {
    const name = p.path.replace(/^packs\//, '').replace(/\/$/, '');
    assert.deepEqual(validatePack(readPack(name)), [], `pack ${name}`);
  }
});

test('respuesta sincronizada: solo del rol que decide y con letra válida', () => {
  const pack = readPack('tramontana');
  const d = pack.rounds[0].decisions[0];
  const ok = acceptRemoteAnswer(pack, { decision_id: d.id, answer: 'C', from: d.role });
  assert.equal(ok.decision.id, d.id);
  assert.equal(ok.answer, 'C');
  const otro = pack.roles.map((r) => r.id).find((r) => r !== d.role);
  assert.equal(acceptRemoteAnswer(pack, { decision_id: d.id, answer: 'C', from: otro }), null);
  assert.equal(acceptRemoteAnswer(pack, { decision_id: d.id, answer: 'Z', from: d.role }), null);
  assert.equal(acceptRemoteAnswer(pack, { decision_id: 'NO-EXISTE', answer: 'A', from: d.role }), null);
  assert.equal(acceptRemoteAnswer(pack, null), null);
});

test('centro de mando: el arco se coloca respecto a donde mira el participante', () => {
  const rig = { pos: { x: 0, y: 1.6, z: 0 }, fwd: { x: 0, z: -1 } };
  const c = slotPose(rig, 'center');
  assert.ok(Math.abs(c.x) < 1e-9 && c.z < 0, 'el panel central queda delante');
  assert.ok(slotPose(rig, 'crisis').x < 0, 'el Panel de Crisis a la izquierda');
  assert.ok(slotPose(rig, 'cards').x > 0, 'las tarjetas del rol a la derecha');
  // Girado 90° a la derecha (mirando a +x), el centro sigue delante.
  const girado = slotPose({ pos: rig.pos, fwd: { x: 1, z: 0 } }, 'center');
  assert.ok(girado.x > 1 && Math.abs(girado.z) < 1e-9);
  assert.equal(slotFor('TABLE'), 'desk');
  assert.equal(slotFor('DESCONOCIDA'), 'center');
});

test('centro de mando: los paneles contiguos del arco no se solapan', () => {
  const span = (slot, w) => [SLOTS[slot].angle - angularWidth(slot, w) / 2, SLOTS[slot].angle + angularWidth(slot, w) / 2];
  const crisis = span('crisis', 1.6), action = span('action', 1.1), center = span('center', 1.1);
  const side = span('side', 1.1), cards = span('cards', 0.72);
  assert.ok(crisis[1] <= action[0], `Panel de Crisis ${crisis} / actuación ${action}`);
  assert.ok(crisis[1] <= center[0], 'Panel de Crisis / lectura');
  assert.ok(side[1] <= cards[0], 'avisos laterales / tarjetas');
  assert.ok(center[1] <= cards[0], 'lectura / tarjetas');
});

test('línea de tiempo de la ronda en curso', () => {
  const pack = readPack('tramontana');
  const steps = buildSteps(pack);
  const i = steps.findIndex((s) => s.kind === 'decision');
  const d = steps[i].decision;
  const tl = timelineFor(steps, i, { [d.id]: { answer: 'B' } }, pack.rounds);
  assert.equal(tl.rounds.length, pack.rounds.length);
  assert.equal(tl.rounds[0].state, 'current');
  const cur = tl.items.find((it) => it.state === 'current');
  assert.equal(cur.icon, 'B');
  assert.ok(tl.items.some((it) => it.state === 'todo'));
});
