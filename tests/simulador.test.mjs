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

test('maqueta: cada pack con site.json es válido y usa servicios del catálogo', async () => {
  const { validateSite } = await import('../js/site-model.js');
  const general = new Set(JSON.parse(fs.readFileSync(new URL('../copiloto/data/servicios.json', import.meta.url))).map((s) => s.codigo));
  const index = JSON.parse(fs.readFileSync(new URL('../packs/index.json', import.meta.url)));
  let withSite = 0;
  for (const p of index.packs) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../${p.path}manifest.json`, import.meta.url)));
    if (!manifest.files.site) continue;
    withSite++;
    const site = JSON.parse(fs.readFileSync(new URL(`../${p.path}${manifest.files.site}`, import.meta.url)));
    // Si el pack trae su propio catálogo, la maqueta se comprueba contra él.
    const catalog = manifest.files.catalog
      ? new Set(JSON.parse(fs.readFileSync(new URL(`../${p.path}${manifest.files.catalog}servicios.json`, import.meta.url))).map((s) => s.codigo))
      : general;
    assert.deepEqual(validateSite(site), [], p.path);
    for (const n of site.nodes) for (const sv of n.services || []) assert.ok(catalog.has(sv), `${p.path} ${n.id}: ${sv} no está en el catálogo`);
  }
  assert.ok(withSite >= 3, 'TRAMONTANA, GREGAL y ALTAMAR traen maqueta');
});

test('maqueta: estado de los nodos según los escenarios declarados y los servicios afectados', async () => {
  const { siteStatus, validateSite } = await import('../js/site-model.js');
  const site = {
    schema: 'crisis.site/1.0', name: 'Prueba',
    nodes: [
      { id: 'SEDE', type: 'building', label: 'Sede', x: 0, z: 0, scenarios: ['E1'], services: ['SV-A', 'SV-B'] },
      { id: 'CPD', type: 'datacenter', label: 'CPD', x: 1, z: 0, scenarios: ['E3'], services: ['SV-C', 'SV-D'] },
      { id: 'ALT', type: 'building', label: 'Alternativa', role: 'backup', x: -1, z: 0, scenarios: ['E2'] },
    ],
    links: [{ from: 'SEDE', to: 'CPD' }, { from: 'ALT', to: 'CPD' }],
  };
  assert.deepEqual(validateSite(site), []);
  const st = siteStatus(site, { selected: { E1: 2 }, affected: [{ codigo: 'SV-C' }] });
  const by = Object.fromEntries(st.nodes.map((n) => [n.id, n]));
  assert.equal(by.SEDE.status, 'hit');
  assert.match(by.SEDE.line, /E1 C2/);
  assert.equal(by.CPD.status, 'impacted');
  assert.equal(by.CPD.line, '1 de 2 servicios afectados');
  assert.equal(by.ALT.status, 'standby');
  assert.equal(st.links[0].status, 'hit');
  assert.equal(st.links[1].status, 'impacted');
  assert.deepEqual(st.summary, { hit: 1, impacted: 1 });
  const nada = siteStatus(site, {});
  assert.ok(nada.nodes.every((n) => n.status === 'ok' || n.status === 'standby'));

  const mal = validateSite({ ...site, nodes: [...site.nodes, { id: 'SEDE', type: 'castillo', label: '', x: 9, z: 0, services: ['SV-A'] }], links: [{ from: 'SEDE', to: 'NADA' }] });
  for (const frag of ['id duplicado', 'tipo «castillo»', 'falta «label»', '«x» debe ser', 'ya depende de', 'NADA']) {
    assert.ok(mal.some((e) => e.includes(frag)), `falta el error: ${frag}`);
  }
});

test('maqueta: no tapa el panel de lectura', () => {
  const center = [-angularWidth('center', 1.1) / 2, angularWidth('center', 1.1) / 2];
  const model = [SLOTS.model.angle - angularWidth('model', 0.64) / 2, SLOTS.model.angle + angularWidth('model', 0.64) / 2];
  assert.ok(model[1] <= center[0], `maqueta ${model} / lectura ${center}`);
});

test('catálogo propio de un pack: servicios, escenarios, estrategias y comunicaciones coherentes', async () => {
  const core = await import('../copiloto/js/core.js');
  const index = JSON.parse(fs.readFileSync(new URL('../packs/index.json', import.meta.url)));
  let packs = 0;
  for (const p of index.packs) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../${p.path}manifest.json`, import.meta.url)));
    if (!manifest.files.catalog) continue;
    packs++;
    const get = (f) => JSON.parse(fs.readFileSync(new URL(`../${p.path}${manifest.files.catalog}${f}`, import.meta.url)));
    const data = { config: get('config.json'), services: get('servicios.json'), scenarios: get('escenarios.json'), estrategias: get('estrategias.json'), comms: get('comunicaciones.json') };
    const required = ['codigo', 'nombre', 'rto', 'mtpd', 'perdidah', 'impactoreputacional', 'n_responsable', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
    for (const s of data.services) for (const k of required) assert.ok(s[k] !== undefined && s[k] !== '', `${p.path} ${s.codigo}: falta ${k}`);
    const ctx = { scenarioRows: data.scenarios, estrategias: data.estrategias, config: data.config };
    // Las rondas del pack deben poder calcularse con su catálogo.
    const rounds = JSON.parse(fs.readFileSync(new URL(`../${p.path}${manifest.files.rounds}`, import.meta.url))).rounds;
    const codes = new Set(data.scenarios.map((e) => e.codigo));
    for (const r of rounds) for (const sc of Object.keys((r.copilot && r.copilot.scenarios) || {})) assert.ok(codes.has(sc), `${p.path} ${r.id}: escenario ${sc} sin definir`);
    const last = rounds[rounds.length - 1].copilot.scenarios;
    const affected = core.computeAffectedServices(data.services, last, ctx);
    assert.ok(affected.length > 0, 'la última ronda afecta a algún servicio');
    const level = core.computeIncidentLevel({ selected: last, affected, elapsed: 3600, lastLoss: 0, ctx });
    assert.equal(level.level, 3, 'la última ronda escala a nivel 3');
    // Comunicaciones: cada contexto tiene elementos y los elementos usan contextos declarados.
    const ctxIds = new Set(data.comms.contexts.map((c) => c.id));
    for (const c of data.comms.contexts) assert.ok(core.getCommsForCtx(c.id, data.comms.items).length > 0, `${p.path}: contexto ${c.id} vacío`);
    for (const it of data.comms.items) for (const c of it.ctx) assert.ok(ctxIds.has(c), `${p.path} ${it.id}: contexto ${c} no declarado`);
  }
  assert.ok(packs >= 1);
});

test('hoja de respuestas: cada opción incorrecta explica por qué no', () => {
  const index = JSON.parse(fs.readFileSync(new URL('../packs/index.json', import.meta.url)));
  for (const p of index.packs) {
    const name = p.path.replace(/^packs\//, '').replace(/\/$/, '');
    const pack = readPack(name);
    for (const r of pack.rounds) for (const d of r.decisions) {
      const a = pack.debrief.assessments[d.id];
      assert.ok(a && a.preferred_response && a.rationale, `${name} ${d.id}: falta respuesta de referencia o justificación`);
      for (const opt of d.answers) {
        if (opt.id === a.preferred_response) continue;
        assert.ok(a.why_not && a.why_not[opt.id] && a.why_not[opt.id].length > 20, `${name} ${d.id}: falta el porqué de la opción ${opt.id}`);
      }
    }
  }
});
