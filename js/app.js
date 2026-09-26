// Simulacro de continuidad · prototipo WebXR (realidad mixta con passthrough en Meta Quest).
import * as THREE from '../vendor/three.module.min.js';
import { Panel, THEME, TEXTURE_OPTIONS } from './panel.js';
import { CrisisPanel, tabFor } from './crisis-panel.js';
import { voice } from './voice.js';
import { loadPackIndex, loadPack, buildSteps } from './pack.js';
import { Session, loadCheckpoint, checkpointKey, download, ENGINE_VERSION } from './session.js';
import { loadCopilotData, roundState, computeSnapshot, widgetSpecs } from './copilot-view.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;

const TYPE_UI = {
  PHONE: { icon: '📞', label: 'Llamada', closed: 'Llamada entrante', open: 'Atender', accent: THEME.green },
  DOCUMENT: { icon: '📄', label: 'Documento', closed: 'Documento sobre la mesa', open: 'Abrir', accent: THEME.blue },
  MESSAGE: { icon: '✉️', label: 'Mensaje', closed: 'Mensaje entrante', open: 'Abrir', accent: THEME.blue },
  MEDIA: { icon: '🎞', label: 'Media', closed: 'Contenido multimedia', open: 'Ver', accent: THEME.blue },
  ALERT: { icon: '⚠️', label: 'Alerta', accent: THEME.red },
  INFO_CARD: { icon: 'ℹ️', label: 'Información', accent: THEME.amber },
};
const CALIBRATION = [
  { id: 'TV', label: 'Pared del Panel de Crisis', hint: 'Apunta a una pared despejada (o a la TV si la usáis) donde quieras el Panel de Crisis y pulsa el gatillo.', dist: 2.5 },
  { id: 'DOOR', label: 'Puerta', hint: 'Apunta a la puerta de la sala y pulsa el gatillo.', dist: 3.0 },
  { id: 'TABLE', label: 'Mesa', hint: 'Apunta a la mesa, delante de ti, y pulsa el gatillo.', dist: 0.9 },
  { id: 'FRONT', label: 'Zona de lectura', hint: 'Mira al frente, a donde quieras leer preguntas, y pulsa el gatillo.', dist: 1.2 },
];

const S = {
  pack: null, steps: [], session: null, role: null, roleInfo: null,
  mode: null, // 'xr' | 'desktop'
  phase: 'idle', // calibrate | ready | countdown | run | menu
  anchors: {}, calibIndex: 0, afterCalibration: null,
  ui: {}, audio: null, ringTimer: null, lastHudSecond: -1,
  copilot: { data: null, round: null, st: null, startedReal: 0, visible: false, lastSecond: -1 },
  crisis: null, depth: false,
};

/* ─────────────────────────── Pantallas DOM ─────────────────────────── */

function show(screenId) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== screenId;
  document.body.classList.toggle('running', screenId === 'screen-xr');
}

function todaySessionId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-01`;
}

async function initSetup() {
  $('session-id').value = todaySessionId();
  const sel = $('pack-select');
  try {
    const idx = await loadPackIndex();
    for (const p of idx.packs) {
      const o = document.createElement('option');
      o.value = p.path; o.textContent = p.label;
      sel.appendChild(o);
    }
  } catch (e) {
    $('pack-status').textContent = 'No se pudo leer el catálogo de packs: ' + e.message;
    return;
  }
  sel.addEventListener('change', () => selectPack(sel.value));
  await selectPack(sel.value);

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!S.pack || S.pack.errors.length) return;
    const role = new FormData(e.target).get('role');
    if (!role) { $('setup-error').textContent = 'Elige el rol de este visor.'; return; }
    S.role = role;
    S.roleInfo = S.pack.roles.find((r) => r.id === role);
    S.sessionId = $('session-id').value.trim() || todaySessionId();
    S.participant = $('participant').value.trim() || null;
    renderBrief();
  });

  const xrOk = await xrSupported();
  $('xr-status').textContent = xrOk
    ? 'Realidad mixta disponible en este navegador.'
    : window.isSecureContext
      ? 'Este navegador no ofrece realidad mixta (immersive-ar). Puedes usar el modo escritorio para probar.'
      : 'La realidad mixta exige HTTPS o localhost. Abre la aplicación desde una URL https://.';
  $('btn-enter-xr').disabled = !xrOk;
}

async function selectPack(path) {
  $('pack-status').textContent = 'Cargando pack…';
  $('pack-errors').replaceChildren();
  try {
    S.pack = await loadPack(path);
  } catch (e) {
    S.pack = null;
    $('pack-status').textContent = 'Error al cargar el pack: ' + e.message;
    return;
  }
  const m = S.pack.manifest;
  $('pack-status').textContent = S.pack.errors.length
    ? `El pack ${m.exercise_id} v${m.version} tiene errores y no puede usarse:`
    : `✓ ${m.name} · v${m.version} · ${S.pack.rounds.length} rondas · ${S.pack.decisionCount} decisiones · ${m.duration_minutes} min`;
  for (const err of S.pack.errors) {
    const li = document.createElement('li'); li.textContent = err; $('pack-errors').appendChild(li);
  }
  const roles = $('roles');
  roles.replaceChildren();
  for (const r of S.pack.roles) {
    const label = document.createElement('label');
    label.className = 'role-option';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'role'; input.value = r.id;
    const span = document.createElement('span'); span.textContent = r.name;
    label.append(input, span);
    roles.appendChild(label);
  }
  $('btn-setup').disabled = !!S.pack.errors.length;
}

function renderBrief() {
  const r = S.roleInfo;
  $('brief-role').textContent = r.name;
  $('brief-session').textContent = `Sesión ${S.sessionId} · ${S.pack.manifest.name} v${S.pack.manifest.version}`;
  const fill = (ul, items) => ul.replaceChildren(...(items || []).map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  fill($('brief-functions'), r.functions);
  fill($('brief-rules'), r.rules);
  $('brief-intro').textContent = S.pack.manifest.intro || '';

  const cp = loadCheckpoint(S.pack, S.sessionId, S.role);
  const box = $('brief-resume');
  box.hidden = !cp;
  if (cp) {
    const step = buildSteps(S.pack)[cp.step_index];
    const where = step && step.round ? `ronda ${step.round.number} (${step.round.title})` : 'final';
    $('resume-info').textContent = `Hay una sesión guardada para ${S.role}: ${Object.keys(cp.decisions).length} decisiones registradas, detenida en ${where}.`;
  }
  $('opt-resume').checked = !!cp;
  $('opt-voice').checked = voice.enabled;
  show('screen-brief');
}

function prepareSession() {
  S.steps = buildSteps(S.pack);
  const cp = loadCheckpoint(S.pack, S.sessionId, S.role);
  if (cp && $('opt-resume').checked) {
    S.session = Session.fromCheckpoint(S.pack, cp);
  } else {
    if (cp) {
      // Nunca se descarta evidencia: el registro anterior se archiva con otra clave.
      try { localStorage.setItem(checkpointKey(S.pack, S.sessionId, S.role) + ':archived:' + Date.now(), JSON.stringify(cp)); } catch { /* sin almacenamiento */ }
    }
    S.session = new Session(S.pack, { sessionId: S.sessionId, role: S.role, participant: S.participant });
    S.session.save();
  }
}

function renderSummary() {
  const s = S.session;
  const sum = s.summary();
  const fmt = (sec) => new Date(sec * 1000).toISOString().substring(11, 19);
  $('sum-title').textContent = `${s.data.exercise.id} · Sesión ${s.data.session_id} · ${s.role}`;
  $('sum-state').textContent = s.data.completed_at ? 'Sesión completada' : 'Sesión en curso (guardada; puede reanudarse)';
  const stats = [
    ['Rondas completadas', `${sum.rounds_completed} / ${sum.rounds_total}`],
    ['Decisiones registradas', `${sum.decisions_recorded} / ${sum.decisions_total}`],
    ['Propias / observadas', `${sum.decisions_own} / ${sum.decisions_observed}`],
    ['Acciones en el panel confirmadas', String(sum.panel_actions_confirmed)],
    ['Correcciones', String(sum.corrections)],
    ['Duración', fmt(sum.duration_seconds)],
  ];
  $('sum-stats').replaceChildren(...stats.map(([k, v]) => {
    const div = document.createElement('div'); div.className = 'stat';
    const b = document.createElement('b'); b.textContent = v;
    const span = document.createElement('span'); span.textContent = k;
    div.append(b, span); return div;
  }));
  const rows = [];
  for (const round of S.pack.rounds) {
    for (const d of round.decisions) {
      const rec = s.data.decisions[d.id];
      const tr = document.createElement('tr');
      for (const v of [round.id, d.id, d.role, rec?.answer ?? '—', rec ? (rec.answer_source === 'own' ? 'propia' : 'observada') : '—', rec ? `${rec.response_seconds} s` : '—']) {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      }
      rows.push(tr);
    }
  }
  $('sum-rows').replaceChildren(...rows);
  show('screen-summary');
}

function wireButtons() {
  $('btn-back-setup').addEventListener('click', () => show('screen-setup'));
  $('btn-enter-xr').addEventListener('click', () => { prepareSession(); startXR(); });
  $('btn-enter-desktop').addEventListener('click', () => { prepareSession(); startDesktop(); });
  $('btn-brief-summary').addEventListener('click', () => {
    const cp = loadCheckpoint(S.pack, S.sessionId, S.role);
    if (cp) { S.steps = buildSteps(S.pack); S.session = Session.fromCheckpoint(S.pack, cp); renderSummary(); }
  });
  $('btn-json').addEventListener('click', () => download(S.session.fileBase() + '.json', S.session.toJSON(), 'application/json'));
  $('btn-csv').addEventListener('click', () => download(S.session.fileBase() + '.csv', S.session.toCSV(), 'text/csv;charset=utf-8'));
  $('btn-resume-xr').addEventListener('click', () => { $('opt-resume').checked = true; prepareSession(); S.mode === 'desktop' ? startDesktop() : startXR(); });
  $('btn-new').addEventListener('click', () => { location.reload(); });
}

/* ─────────────────────────── Escena 3D ─────────────────────────── */

let renderer, scene, camera, world, raycaster;
const controllers = [];
const stepPanel = new Panel(1.1);
const hudPanel = new Panel(0.62, 0.8);
const calibPanel = new Panel(0.8, 0.9);
const copilotPanels = [new Panel(0.72, 0.85), new Panel(0.72, 0.85)];
let reticle, desktopProps, listener, soundAnchor, soundSource, soundBus;
const markers = {};

async function xrSupported() {
  try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
}

function initThree() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  $('stage').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(0, 1.6, 0);
  world = new THREE.Group();
  scene.add(world);
  TEXTURE_OPTIONS.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Audio espacial: el oyente va con la cabeza; los sonidos salen del objeto que suena (teléfono, puerta…).
  listener = new THREE.AudioListener();
  camera.add(listener);
  soundAnchor = new THREE.Object3D();
  world.add(soundAnchor);
  soundSource = new THREE.PositionalAudio(listener);
  soundBus = listener.context.createGain();
  soundSource.setNodeSource(soundBus);
  soundSource.setRefDistance(0.8);
  soundSource.setRolloffFactor(1.2);
  soundSource.setDistanceModel('inverse');
  soundAnchor.add(soundSource);
  ensureCrisis();
  raycaster = new THREE.Raycaster();

  for (const p of [stepPanel, hudPanel, calibPanel, ...copilotPanels]) { p.mesh.visible = false; world.add(p.mesh); }

  reticle = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 32), new THREE.MeshBasicMaterial({ color: 0xdbf266, side: THREE.DoubleSide, depthTest: false }));
  reticle.renderOrder = 20;
  reticle.visible = false;
  world.add(reticle);

  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(0, 0, -1)]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xdbf266, transparent: true, opacity: 0.8 }));
    line.scale.z = 2;
    c.add(line);
    c.userData = { line, source: null, hitSource: null, dist: 2, hover: null };
    c.addEventListener('connected', (e) => onControllerConnected(c, e.data));
    c.addEventListener('disconnected', () => { c.userData.source = null; c.userData.hitSource?.cancel?.(); c.userData.hitSource = null; });
    c.addEventListener('selectstart', () => { S.activeController = c; });
    c.addEventListener('select', () => onSelect(c));
    scene.add(c);
    controllers.push(c);
  }

  window.addEventListener('resize', () => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setAnimationLoop(loop);
}

function onControllerConnected(c, source) {
  c.userData.source = source;
  if (!S.activeController || source.handedness === 'right') S.activeController = c;
  const session = renderer.xr.getSession();
  if (session && session.requestHitTestSource) {
    session.requestHitTestSource({ space: source.targetRaySpace })
      .then((hs) => { c.userData.hitSource = hs; })
      .catch(() => { /* hit-test no disponible: se usa distancia fija */ });
  }
}

function getHead() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const pos = new V3(); const dir = new V3();
  cam.getWorldPosition(pos);
  cam.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
  dir.normalize();
  const right = new V3(-dir.z, 0, dir.x);
  return { pos, fwd: dir, right };
}

function defaultAnchor(id) {
  const { pos, fwd, right } = getHead();
  const floorY = pos.y > 1.0 ? 0 : pos.y - 1.5;
  switch (id) {
    case 'TV': return pos.clone().addScaledVector(fwd, 3).setY(floorY + 1.35);
    case 'DOOR': return pos.clone().addScaledVector(fwd, 2).addScaledVector(right, -2.2).setY(floorY + 1.5);
    case 'TABLE': return pos.clone().addScaledVector(fwd, 0.75).setY(Math.max(floorY + 0.75, pos.y - 0.6));
    default: return pos.clone().addScaledVector(fwd, 1.2).setY(pos.y - 0.05);
  }
}

// Separa de la pared lo que se ancla en ella, para que la oclusión por profundidad no lo "corte".
function standOff(point, head, meters = 0.15) {
  const d = head.clone().sub(point); d.y = 0;
  if (d.lengthSq() > 1e-6) point.addScaledVector(d.normalize(), meters);
  return point;
}

/* ─────────────────────────── Panel de Crisis virtual ─────────────────────────── */

function ensureCrisis() {
  if (S.crisis || !S.copilot.data || !world) return;
  S.crisis = new CrisisPanel({
    data: S.copilot.data,
    onEvent: (type, payload) => {
      if (S.session && (S.phase === 'run' || S.phase === 'menu')) {
        const r = S.steps[S.session.stepIndex] && S.steps[S.session.stepIndex].round;
        S.session.log(type, { round_id: r ? r.id : null, ...payload });
      }
    },
  });
  S.crisis.mesh.visible = false;
  world.add(S.crisis.mesh);
}

function crisisScale() {
  const tv = S.anchors.TV || defaultAnchor('TV');
  const d = tv.clone().sub(getHead().pos); d.y = 0;
  return THREE.MathUtils.clamp(d.length() / 2.0, 1, 1.8);
}
function crisisHalfWidth() {
  return S.crisis ? (S.crisis.widthM / 2) * crisisScale() : 0.6;
}

function placeCrisis() {
  if (!S.crisis) return;
  const head = getHead().pos;
  const a = standOff((S.anchors.TV || defaultAnchor('TV')).clone(), head);
  const scale = crisisScale();
  const m = S.crisis.mesh;
  m.position.copy(a);
  m.position.y = Math.max(a.y, (S.crisis.heightM * scale) / 2 + 0.45);
  m.rotation.set(0, 0, 0);
  facing(m, head);
  m.scale.setScalar(scale);
  m.visible = true;
}

function crisisAction(id) {
  if (!S.crisis || !id) return;
  beep(1500, 0.04, 0, 0.08);
  S.crisis.handle(id);
  updateCopilot(true);
}

function facing(obj, target) {
  obj.lookAt(target.x, obj.position.y, target.z);
}

// Coloca un panel en su ancla con orientación y escala adecuadas para la lectura.
function place(panel, anchorId) {
  const head = getHead().pos;
  const a = (S.anchors[anchorId] || defaultAnchor(anchorId)).clone();
  const m = panel.mesh;
  m.rotation.set(0, 0, 0);
  const toAnchor = a.clone().sub(head); toAnchor.y = 0;
  const dist = Math.max(0.3, toAnchor.length());
  let scale = 1;
  if (anchorId === 'TV' || anchorId === 'DOOR') standOff(a, head);
  if (anchorId === 'TV') {
    const dir = toAnchor.normalize();
    const right = new V3(-dir.z, 0, dir.x);
    scale = THREE.MathUtils.clamp(dist / 1.4, 1, 2.6);
    a.addScaledVector(right, crisisHalfWidth() + 0.55 * scale + 0.12); // a la derecha del Panel de Crisis
  } else if (anchorId === 'DOOR') {
    scale = THREE.MathUtils.clamp(dist / 1.4, 1, 2.6);
  } else if (anchorId === 'TABLE') {
    scale = 0.75; // objeto de mesa: más pequeño y cercano
    const tilt = THREE.MathUtils.degToRad(35);
    a.y += (panel.heightM * scale / 2) * Math.cos(tilt) + 0.03;
  }
  m.position.copy(a);
  facing(m, head);
  if (anchorId === 'TABLE') m.rotateX(-THREE.MathUtils.degToRad(35));
  m.scale.setScalar(scale);
  m.userData.baseScale = scale;
  m.userData.anchor = anchorId;
  m.visible = true;
}

function placeHud() {
  const front = S.anchors.FRONT || defaultAnchor('FRONT');
  const m = hudPanel.mesh;
  const onFront = stepPanel.mesh.visible && stepPanel.mesh.userData.anchor === 'FRONT';
  m.position.copy(front);
  // Encima del panel frontal, o bajo la línea de mirada si el foco está en TV/puerta/mesa.
  m.position.y += onFront ? stepPanel.heightM / 2 + hudPanel.heightM / 2 + 0.04 : -0.45;
  m.rotation.set(0, 0, 0);
  facing(m, getHead().pos);
  m.visible = true;
}

/* ─────────────────────────── Audio ─────────────────────────── */

function initAudio() {
  try { S.audio = listener ? listener.context : S.audio || new (window.AudioContext || window.webkitAudioContext)(); S.audio.resume(); } catch { S.audio = null; }
}
// positional: el sonido sale de soundAnchor (colocado sobre el objeto que lo produce).
function beep(freq = 880, dur = 0.15, when = 0, gain = 0.15, positional = false) {
  if (!S.audio) return;
  const t = S.audio.currentTime + when;
  const o = S.audio.createOscillator(); const g = S.audio.createGain();
  o.frequency.value = freq; o.type = 'sine';
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(positional && soundBus ? soundBus : S.audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
function soundAt(obj) {
  if (soundAnchor && obj) soundAnchor.position.copy(obj.position);
}
function startRing() {
  stopRing();
  soundAt(stepPanel.mesh);
  const ring = () => { for (let i = 0; i < 4; i++) { beep(1200, 0.08, i * 0.1, 0.35, true); beep(900, 0.08, i * 0.1 + 0.05, 0.35, true); } };
  ring();
  S.ringTimer = setInterval(ring, 2000);
}
function stopRing() { clearInterval(S.ringTimer); S.ringTimer = null; }

/* ─────────────────────────── Entrada / salida ─────────────────────────── */

async function startXR() {
  voice.setEnabled($('opt-voice').checked);
  voice.say('Realidad mixta activada. Calibra la sala.');
  initAudio();
  initThree();
  S.mode = 'xr';
  if (desktopProps) desktopProps.visible = false;
  let session;
  try {
    const base = { requiredFeatures: ['local-floor'], optionalFeatures: ['hit-test', 'hand-tracking'] };
    const useDepth = $('opt-depth') ? $('opt-depth').checked : true;
    try {
      session = await navigator.xr.requestSession('immersive-ar', useDepth ? {
        ...base,
        optionalFeatures: [...base.optionalFeatures, 'depth-sensing'],
        depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
      } : base);
    } catch {
      session = await navigator.xr.requestSession('immersive-ar', base); // visor sin profundidad
    }
  } catch (e) {
    alert('No se pudo iniciar la realidad mixta: ' + e.message);
    return;
  }
  S.depth = !!(session.enabledFeatures && session.enabledFeatures.includes('depth-sensing'));
  session.addEventListener('end', onXREnd);
  await renderer.xr.setSession(session);
  show('screen-xr');
  // Esperar un par de frames para tener la pose de la cabeza antes de calibrar.
  setTimeout(() => beginCalibration(), 400);
}

function onXREnd() {
  stopRing();
  hideAll();
  S.phase = 'idle';
  renderSummary();
}

function startDesktop() {
  voice.setEnabled($('opt-voice').checked);
  initAudio();
  initThree();
  S.mode = 'desktop';
  show('screen-xr');
  $('desktop-help').hidden = false;
  renderer.domElement.classList.add('desktop');
  scene.background = new THREE.Color(0x0b1020);
  camera.position.set(0, 1.6, 0); camera.rotation.set(0, 0, 0);
  for (const c of CALIBRATION) S.anchors[c.id] = defaultAnchor(c.id);
  // En escritorio la zona de lectura va a la derecha para no tapar el Panel de Crisis.
  { const { pos, fwd, right } = getHead(); S.anchors.FRONT = pos.clone().addScaledVector(fwd, 1.3).addScaledVector(right, 0.95).setY(pos.y - 0.15); }
  buildDesktopProps();
  enterReady();
}

function exitRun() {
  stopRing();
  if (S.mode === 'xr' && renderer.xr.getSession()) renderer.xr.getSession().end();
  else { hideAll(); S.phase = 'idle'; $('desktop-help').hidden = true; renderSummary(); }
}

function hideAll() {
  voice.stop();
  for (const p of [stepPanel, hudPanel, calibPanel, ...copilotPanels]) p.mesh.visible = false;
  if (S.crisis) S.crisis.mesh.visible = false;
  reticle.visible = false;
  for (const k in markers) markers[k].visible = false;
}

function buildDesktopProps() {
  if (desktopProps) { desktopProps.visible = true; return; }
  desktopProps = new THREE.Group();
  const grid = new THREE.GridHelper(12, 24, 0x334155, 0x1e293b);
  desktopProps.add(grid);
  const box = (w, h, d, color, pos) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos); desktopProps.add(m); return m;
  };
  box(1.4, 0.8, 0.05, 0x1f2937, S.anchors.TV.clone());
  box(1.6, 0.05, 0.9, 0x3f3f46, S.anchors.TABLE.clone().setY(S.anchors.TABLE.y - 0.03));
  const door = box(0.05, 2.0, 0.9, 0x78350f, S.anchors.DOOR.clone().setY(1.0));
  door.lookAt(camera.position.x, 1.0, camera.position.z);
  scene.add(desktopProps);
}

/* ─────────────────────────── Calibración ─────────────────────────── */

function beginCalibration(after = null) {
  S.phase = 'calibrate';
  S.calibIndex = 0;
  S.afterCalibration = after;
  stepPanel.mesh.visible = false;
  hudPanel.mesh.visible = false;
  showCalibrationStep();
}

function showCalibrationStep() {
  const c = CALIBRATION[S.calibIndex];
  for (const ctl of controllers) ctl.userData.dist = c.dist;
  calibPanel.set({
    accent: THEME.lime, icon: '📍',
    kicker: `Calibrar sala · ${S.calibIndex + 1} de ${CALIBRATION.length}`,
    title: c.label, body: c.hint,
    note: c.id === 'FRONT' ? null : 'Si no aparece el círculo sobre la superficie, usa el joystick para acercarlo o alejarlo.',
    buttons: [
      ...(S.calibIndex > 0 ? [{ id: 'calib:back', label: '◀ Anterior' }] : []),
      { id: 'calib:default', label: 'Posición por defecto' },
    ],
  });
  const { pos, fwd, right } = getHead();
  const m = calibPanel.mesh;
  m.position.copy(pos).addScaledVector(fwd, 1.0).addScaledVector(right, -0.45);
  m.position.y = pos.y - 0.35;
  m.rotation.set(0, 0, 0);
  facing(m, pos);
  m.rotateX(-THREE.MathUtils.degToRad(20));
  m.visible = true;
}

function setAnchor(id, point) {
  S.anchors[id] = point.clone();
  if (!markers[id]) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdbf266 }));
    markers[id] = g; world.add(g);
  }
  markers[id].position.copy(point);
  markers[id].visible = true;
  beep(1320, 0.1);
  S.calibIndex++;
  if (S.calibIndex >= CALIBRATION.length) finishCalibration();
  else showCalibrationStep();
}

function finishCalibration() {
  calibPanel.mesh.visible = false;
  placeCrisis();
  reticle.visible = false;
  setTimeout(() => { for (const k in markers) markers[k].visible = false; }, 1500);
  if (S.afterCalibration) { const f = S.afterCalibration; S.afterCalibration = null; f(); }
  else enterReady();
}

function calibrationPoint(frame) {
  const c = S.activeController;
  const id = CALIBRATION[S.calibIndex]?.id;
  if (!id) return null;
  if (id === 'FRONT') {
    const { pos, fwd } = getHead();
    return pos.clone().addScaledVector(fwd, 1.2).setY(pos.y - 0.05);
  }
  if (!c || !c.userData.source) return null;
  const refSpace = renderer.xr.getReferenceSpace();
  if (frame && c.userData.hitSource && refSpace) {
    const hits = frame.getHitTestResults(c.userData.hitSource);
    if (hits.length) {
      const p = hits[0].getPose(refSpace);
      if (p) return new V3(p.transform.position.x, p.transform.position.y, p.transform.position.z);
    }
  }
  const gp = c.userData.source.gamepad;
  if (gp && gp.axes.length >= 4) {
    const y = gp.axes[3];
    if (Math.abs(y) > 0.2) c.userData.dist = THREE.MathUtils.clamp(c.userData.dist - y * 0.03, 0.3, 8);
  }
  const { origin, dir } = controllerRay(c);
  return origin.addScaledVector(dir, c.userData.dist);
}

/* ─────────────────────────── Inicio y cuenta atrás ─────────────────────────── */

function enterReady() {
  S.phase = 'ready';
  placeCrisis();
  const resuming = !!S.session.data.started_at;
  const step = S.steps[S.session.stepIndex];
  stepPanel.set({
    accent: THEME.lime, icon: '🟢', kicker: `${S.pack.manifest.exercise_id} · Sesión ${S.session.data.session_id}`,
    title: resuming ? 'Listo para reanudar' : 'Preparado',
    source: S.roleInfo.name,
    body: resuming
      ? `Se reanudará en la ronda ${step.round ? step.round.number : '—'}. Espera la indicación del facilitador.`
      : 'Espera la orden del facilitador. Todos los visores pulsan COMENZAR a la vez.',
    buttons: [{ id: 'start', label: resuming ? 'REANUDAR' : 'COMENZAR', primary: true }, { id: 'recalibrate', label: 'Recalibrar' }],
  });
  place(stepPanel, 'FRONT');
  hudPanel.mesh.visible = false;
}

function countdown() {
  S.phase = 'countdown';
  let n = 3;
  const tick = () => {
    if (n === 0) { beep(1320, 0.25); S.session.start(); S.phase = 'run'; runStep(S.session.stepIndex); return; }
    stepPanel.set({ accent: THEME.lime, kicker: 'Comienza en', title: String(n), buttons: [] });
    place(stepPanel, 'FRONT');
    beep(880, 0.12);
    n--; setTimeout(tick, 1000);
  };
  tick();
}

/* ─────────────────────────── Motor de pasos ─────────────────────────── */

function roleName(id) {
  return (S.pack.roles.find((r) => r.id === id) || { name: id }).name;
}

function goTo(index, reason) {
  const from = S.session.stepIndex;
  if (reason) S.session.log('session_corrected', { kind: reason, from_step: from, to_step: index });
  runStep(index);
}

function runStep(index) {
  stopRing();
  index = THREE.MathUtils.clamp(index, 0, S.steps.length - 1);
  S.session.setStep(index);
  const step = S.steps[index];
  S.ui = { step, open: false, selected: null };
  const sess = S.session;
  voice.stop();
  syncCopilotRound(step.round);
  if (S.crisis && (step.kind === 'round_intro' || !S.crisis.mesh.visible)) placeCrisis();

  if (step.kind === 'round_intro') {
    const r = step.round;
    sess.log('round_started', { round_id: r.id, crisis_time: r.crisis_time });
    voice.say(`Ronda ${r.number}. ${r.title}. ${r.crisis_time.replace('T+', 'Tiempo más ')}.`);
    stepPanel.set({
      accent: THEME.lime, icon: '⏱', kicker: `Ronda ${r.number} de ${S.pack.rounds.length} · ${r.crisis_time}`,
      title: r.title, body: 'Esperad a que todos los visores muestren esta ronda antes de continuar.',
      buttons: [{ id: 'next', label: 'Comenzar ronda', primary: true }],
    });
    place(stepPanel, 'FRONT');
  } else if (step.kind === 'event') {
    const e = step.event;
    sess.log('inject_shown', { round_id: step.round.id, inject_id: e.id, inject_type: e.type, anchor: e.anchor || 'FRONT', target: e.target || 'ALL' });
    renderEvent();
    const t = TYPE_UI[e.type];
    soundAt(stepPanel.mesh);
    if (e.type === 'PHONE') startRing();
    else if (e.type === 'ALERT') { beep(660, 0.2, 0, 0.3, true); beep(660, 0.2, 0.3, 0.3, true); }
    else if (t.open) beep(990, 0.12, 0, 0.3, true);
    if (e.type === 'ALERT' || e.type === 'INFO_CARD') voice.say(`${t.label}. ${e.title || ''}. ${e.text}`);
    else if (e.type === 'PHONE') voice.say(`Llamada entrante. ${e.source || ''}`);
    else voice.say(`${t.closed}. ${e.source || e.title || ''}`);
  } else if (step.kind === 'panel') {
    const a = step.action;
    sess.log('panel_action_shown', { round_id: step.round.id, action_id: a.id, tab: a.tab || null });
    stepPanel.set({
      accent: THEME.blue, icon: '📺', kicker: `Panel de Crisis${a.tab ? ' · ' + a.tab : ''}`,
      title: 'Actuación en el panel', body: a.text,
      note: 'Opera el Panel de Crisis (a tu izquierda) y confirma al terminar.', noteColor: THEME.muted,
      buttons: [{ id: 'panel:done', label: 'Hecho', primary: true }],
    });
    if (S.crisis) S.crisis.setTab(tabFor(a.tab || ''));
    place(stepPanel, 'TV');
    soundAt(S.crisis ? S.crisis.mesh : stepPanel.mesh);
    beep(740, 0.12, 0, 0.3, true);
    voice.say('Actuación en el Panel de Crisis. ' + a.text);
  } else if (step.kind === 'decision') {
    sess.decisionShown(step.round, step.decision);
    voice.say((step.decision.role === S.role ? 'Te toca decidir. ' : `Decide ${step.decision.role}. `) + step.decision.question);
    const prev = sess.data.decisions[step.decision.id];
    S.ui.selected = prev ? prev.answer : null;
    renderDecision();
    beep(520, 0.12); beep(780, 0.12, 0.12);
  } else if (step.kind === 'round_end') {
    const r = step.round;
    sess.log('round_completed', { round_id: r.id });
    const last = r === S.pack.rounds[S.pack.rounds.length - 1];
    stepPanel.set({
      accent: THEME.green, icon: '✓', kicker: `Ronda ${r.number} · ${r.crisis_time}`, title: `Ronda completada`,
      body: 'Cuando todos los visores estén aquí, continuad.',
      buttons: [{ id: 'next', label: last ? 'Finalizar ejercicio' : 'Siguiente ronda', primary: true }],
    });
    place(stepPanel, 'FRONT');
  } else if (step.kind === 'end') {
    sess.complete();
    const sum = sess.summary();
    stepPanel.set({
      accent: THEME.lime, icon: '🏁', kicker: 'Fin del ejercicio', title: S.pack.manifest.name,
      body: `${sum.decisions_recorded} de ${sum.decisions_total} decisiones registradas (${sum.decisions_own} propias, ${sum.decisions_observed} observadas).\n\n${S.pack.manifest.ending || ''}`,
      buttons: [{ id: 'exit', label: 'Salir y exportar', primary: true }],
    });
    place(stepPanel, 'FRONT');
  }
  placeHud();
  updateHud(true);
}

function renderEvent() {
  const { step, open } = S.ui;
  const e = step.event;
  const t = TYPE_UI[e.type];
  const target = e.target && e.target !== 'ALL' ? ` · Para ${e.target}` : '';
  const closable = !!t.open;
  if (closable && !open) {
    stepPanel.set({
      accent: t.accent, icon: t.icon, kicker: `${t.label}${target}`,
      title: t.closed, source: e.source || e.title,
      buttons: [{ id: 'event:open', label: t.open, primary: true }],
    });
  } else {
    stepPanel.set({
      accent: t.accent, icon: t.icon, kicker: `${t.label}${target}`,
      title: e.title || t.label, source: e.source, body: e.text,
      buttons: [{ id: 'event:ack', label: 'Entendido', primary: true }],
    });
  }
  place(stepPanel, e.anchor || 'FRONT');
  stepPanel.mesh.userData.pulse = e.type === 'PHONE' && !open;
}

function renderDecision() {
  const d = S.ui.step.decision;
  const mine = d.role === S.role;
  const sel = S.ui.selected;
  stepPanel.set({
    accent: mine ? THEME.lime : THEME.blue,
    kicker: `${d.id} · Decide ${d.role}${mine ? ' · TU TURNO' : ''}`,
    title: d.question,
    note: mine
      ? 'Te toca: elige, anuncia la letra en voz alta y confirma.'
      : `Decide ${roleName(d.role)}. Espera su anuncio y registra la letra.`,
    noteColor: mine ? THEME.lime : THEME.amber,
    answers: d.answers.map((a) => ({ id: a.id, text: a.text, state: sel === a.id ? 'selected' : '' })),
    buttons: [sel
      ? { id: 'decision:confirm', label: mine ? `Confirmar ${sel}` : `Registrar ${sel} (observada)`, primary: true }
      : { id: 'noop', label: mine ? 'Elige una respuesta' : 'Registra la respuesta anunciada', disabled: true }],
  });
  place(stepPanel, 'FRONT');
}

function showDecisionResult(rec) {
  stepPanel.set({
    accent: THEME.green, icon: '✓', kicker: `${rec.decision_id} · Registrado`,
    title: `Respuesta ${rec.answer}`,
    body: rec.answer_source === 'own' ? `Decisión propia · ${rec.response_seconds} s` : `Respuesta observada de ${rec.active_role}`,
    buttons: [],
  });
  place(stepPanel, 'FRONT');
  beep(1320, 0.12);
  const at = S.session.stepIndex;
  setTimeout(() => { if (S.phase === 'run' && S.session.stepIndex === at) runStep(at + 1); }, 1300);
}

/* ─────────────────────────── HUD y menú ─────────────────────────── */

function updateHud(force = false) {
  if (!S.session || S.phase !== 'run') return;
  const sec = S.session.elapsedSeconds();
  if (!force && sec === S.lastHudSecond) return;
  S.lastHudSecond = sec;
  const step = S.steps[S.session.stepIndex];
  const r = step.round;
  const clock = new Date(sec * 1000).toISOString().substring(11, 19);
  hudPanel.set({
    accent: THEME.border,
    kicker: `${S.role} · ${r ? `Ronda ${r.number}/${S.pack.rounds.length} · ${r.crisis_time}` : 'Fin'}`,
    title: `⏱ ${clock}`,
    buttons: [{ id: 'menu', label: 'Menú' }, { id: 'copilot', label: S.copilot.visible ? 'Resumen ◉' : 'Resumen ○' }, { id: 'voice', label: voice.enabled ? 'Voz ◉' : 'Voz ○' }],
  });
  const onFront = stepPanel.mesh.visible && stepPanel.mesh.userData.anchor === 'FRONT';
  if (!onFront || force) placeHud();
}

/* ─────────────────────────── Copiloto junto a la TV ─────────────────────────── */

function syncCopilotRound(round) {
  if (!round || round === S.copilot.round) return;
  S.copilot.round = round;
  S.copilot.st = roundState(round);
  S.copilot.startedReal = Date.now();
  if (S.crisis && round.copilot) S.crisis.setRoundBaseline(S.copilot.st, `la ronda ${round.number}`);
  updateCopilot(true);
}

function updateCopilot(force = false) {
  const c = S.copilot;
  const show = c.data && c.round && c.visible && (S.phase === 'run' || S.phase === 'menu');
  if (!show) { for (const p of copilotPanels) p.mesh.visible = false; return; }
  const elapsedReal = Date.now() - c.startedReal;
  const second = Math.floor(elapsedReal / 1000);
  if (!force && second === c.lastSecond) return;
  c.lastSecond = second;
  const snap = S.crisis ? S.crisis.snapshot() : computeSnapshot(c.data, c.st, elapsedReal);
  const specs = widgetSpecs(S.role, snap, c.data.config);
  copilotPanels.forEach((p, i) => { if (specs[i]) p.set(specs[i]); p.mesh.visible = !!specs[i]; });
  placeCopilot();
}

// Columna a la izquierda de la TV (las actuaciones del panel van a la derecha).
function placeCopilot() {
  const head = getHead().pos;
  const tv = (S.anchors.TV || defaultAnchor('TV')).clone();
  const to = tv.clone().sub(head); to.y = 0;
  const dist = Math.max(0.3, to.length());
  const dir = to.normalize();
  const right = new V3(-dir.z, 0, dir.x);
  const scale = THREE.MathUtils.clamp(dist / 1.4, 1, 2.2);
  const visible = copilotPanels.filter((p) => p.mesh.visible);
  const total = visible.reduce((h, p) => h + p.heightM * scale, 0) + 0.05 * scale * (visible.length - 1);
  let top = tv.y + total / 2;
  for (const p of visible) {
    const m = p.mesh;
    const hgt = p.heightM * scale;
    m.position.copy(standOff(tv.clone(), head)).addScaledVector(right, -(crisisHalfWidth() + 0.36 * scale + 0.12));
    m.position.y = top - hgt / 2;
    top -= hgt + 0.05 * scale;
    m.rotation.set(0, 0, 0);
    facing(m, head);
    m.scale.setScalar(scale);
  }
}

function openMenu() {
  S.phase = 'menu';
  stopRing();
  const i = S.session.stepIndex;
  const step = S.steps[i];
  stepPanel.set({
    accent: THEME.amber, icon: '☰', kicker: `Paso ${i + 1} de ${S.steps.length}`,
    title: 'Menú del visor',
    body: step.round ? `Ronda ${step.round.number} · ${step.round.title}` : 'Final del ejercicio',
    vertical: true,
    buttons: [
      { id: 'menu:close', label: 'Continuar donde estaba', primary: true },
      { id: 'menu:prev', label: '◀ Paso anterior', disabled: i === 0 },
      { id: 'menu:next', label: 'Paso siguiente ▶', disabled: i >= S.steps.length - 1 },
      { id: 'menu:prevRound', label: '◀◀ Inicio de ronda anterior' },
      { id: 'menu:nextRound', label: 'Inicio de ronda siguiente ▶▶' },
      { id: 'menu:recalibrate', label: 'Recalibrar sala' },
      { id: 'menu:exit', label: 'Salir (la sesión queda guardada)' },
    ],
  });
  place(stepPanel, 'FRONT');
  hudPanel.mesh.visible = false;
}

function roundStartIndex(from, dir) {
  let i = from;
  const cur = S.steps[from].round;
  if (dir < 0) {
    // inicio de la ronda actual; si ya estamos en él, el de la anterior
    let start = S.steps.findIndex((s) => s.kind === 'round_intro' && s.round === cur);
    if (start < 0 || start === from || S.steps[from].kind === 'end') {
      for (i = Math.min(from, S.steps.length - 1) - 1; i >= 0; i--) if (S.steps[i].kind === 'round_intro' && S.steps[i].round !== cur) return i;
      return 0;
    }
    return start;
  }
  for (i = from + 1; i < S.steps.length; i++) if (S.steps[i].kind === 'round_intro' || S.steps[i].kind === 'end') return i;
  return S.steps.length - 1;
}

/* ─────────────────────────── Interacción ─────────────────────────── */

function handleAction(id) {
  if (!id || id === 'noop') return;
  beep(1500, 0.04, 0, 0.08);
  const sess = S.session;
  if (id === 'calib:default') { setAnchor(CALIBRATION[S.calibIndex].id, defaultAnchor(CALIBRATION[S.calibIndex].id)); return; }
  if (id === 'calib:back') { S.calibIndex = Math.max(0, S.calibIndex - 1); showCalibrationStep(); return; }
  if (id === 'start') { countdown(); return; }
  if (id === 'recalibrate') { beginCalibration(); return; }
  if (id === 'menu') { openMenu(); return; }
  if (id === 'voice') { voice.setEnabled(!voice.enabled); updateHud(true); return; }
  if (id === 'copilot') {
    S.copilot.visible = !S.copilot.visible;
    sess.log('copilot_toggled', { visible: S.copilot.visible });
    updateCopilot(true); updateHud(true); return;
  }
  if (id === 'exit') { exitRun(); return; }
  if (id.startsWith('menu:')) {
    const i = sess.stepIndex;
    S.phase = 'run';
    switch (id) {
      case 'menu:close': runStepResume(); return;
      case 'menu:prev': goTo(i - 1, 'manual_navigation'); return;
      case 'menu:next': goTo(i + 1, 'manual_navigation'); return;
      case 'menu:prevRound': goTo(roundStartIndex(i, -1), 'manual_navigation'); return;
      case 'menu:nextRound': goTo(roundStartIndex(i, 1), 'manual_navigation'); return;
      case 'menu:recalibrate': S.phase = 'calibrate'; beginCalibration(() => { S.phase = 'run'; runStepResume(); }); return;
      case 'menu:exit': exitRun(); return;
    }
  }
  const { step } = S.ui;
  if (!step) return;
  if (id === 'next') { runStep(sess.stepIndex + 1); return; }
  if (id === 'event:open') {
    stopRing();
    sess.log('inject_opened', { round_id: step.round.id, inject_id: step.event.id });
    S.ui.open = true; renderEvent();
    voice.say(`${step.event.title || ''}. ${step.event.text}`);
    return;
  }
  if (id === 'event:ack') {
    sess.log('inject_acknowledged', { round_id: step.round.id, inject_id: step.event.id });
    runStep(sess.stepIndex + 1); return;
  }
  if (id === 'panel:done') {
    sess.log('panel_action_confirmed', { round_id: step.round.id, action_id: step.action.id });
    runStep(sess.stepIndex + 1); return;
  }
  if (id.startsWith('answer:') && step.kind === 'decision') {
    S.ui.selected = id.slice(7); renderDecision(); return;
  }
  if (id === 'decision:confirm' && S.ui.selected) {
    const rec = sess.decisionAnswered(step.round, step.decision, S.ui.selected);
    showDecisionResult(rec);
  }
}

// Vuelve a mostrar el paso actual sin volver a registrarlo como nuevo evento.
function runStepResume() {
  const step = S.steps[S.session.stepIndex];
  if (step.kind === 'decision') { S.ui = { step, open: false, selected: S.session.data.decisions[step.decision.id]?.answer || null }; renderDecision(); placeHud(); updateHud(true); }
  else runStep(S.session.stepIndex);
}

function controllerRay(c) {
  const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
  const origin = new V3().setFromMatrixPosition(c.matrixWorld);
  const dir = new V3(0, 0, -1).applyMatrix4(m).normalize();
  return { origin, dir };
}

function interactiveMeshes() {
  return [stepPanel, hudPanel, calibPanel, S.crisis].filter((p) => p && p.mesh.visible).map((p) => p.mesh);
}

function pick(origin, dir) {
  raycaster.set(origin, dir);
  const hit = raycaster.intersectObjects(interactiveMeshes(), false)[0];
  if (!hit || !hit.uv) return { panel: null, id: null, distance: null };
  const panel = hit.object.userData.panel;
  return { panel, id: panel.hitTest(hit.uv), distance: hit.distance };
}

function onSelect(c) {
  if (!c.userData.source) return;
  const { origin, dir } = controllerRay(c);
  const { id, panel } = pick(origin, dir);
  if (panel) { if (panel === S.crisis) crisisAction(id); else handleAction(id); return; }
  if (S.phase === 'calibrate') {
    const p = S.lastCalibPoint;
    if (p) setAnchor(CALIBRATION[S.calibIndex].id, p);
  }
}

// Ratón (modo escritorio): arrastrar para mirar, clic para seleccionar.
function initMouse() {
  const el = renderer.domElement;
  let down = null; let yaw = 0; let pitch = 0;
  const ndc = (e) => new THREE.Vector2((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1);
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; });
  el.addEventListener('pointermove', (e) => {
    if (S.mode !== 'desktop') return;
    S.mouse = ndc(e);
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) down.moved = true;
      if (down.moved) {
        yaw = down.yaw - dx * 0.004; pitch = THREE.MathUtils.clamp(down.pitch - dy * 0.004, -1.2, 1.2);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
      }
    }
  });
  el.addEventListener('pointerup', (e) => {
    if (S.mode === 'desktop' && down && !down.moved) {
      raycaster.setFromCamera(ndc(e), camera);
      const { id, panel } = pick(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
      if (panel && panel === S.crisis) crisisAction(id); else handleAction(id);
    }
    down = null;
  });
}

/* ─────────────────────────── Bucle ─────────────────────────── */

function loop(time, frame) {
  if (!S.mode) return;
  const hovers = new Map();
  if (renderer.xr.isPresenting) {
    for (const c of controllers) {
      if (!c.userData.source) { c.userData.line.visible = false; continue; }
      c.userData.line.visible = true;
      const { origin, dir } = controllerRay(c);
      const { panel, id, distance } = pick(origin, dir);
      c.userData.line.scale.z = distance ?? 2;
      if (panel && id) hovers.set(panel, id);
    }
    if (S.phase === 'calibrate') {
      const p = calibrationPoint(frame);
      S.lastCalibPoint = p;
      if (p) {
        reticle.position.copy(p);
        reticle.lookAt(getHead().pos);
        reticle.visible = true;
      } else reticle.visible = false;
    }
  } else if (S.mouse) {
    raycaster.setFromCamera(S.mouse, camera);
    const { panel, id } = pick(raycaster.ray.origin.clone(), raycaster.ray.direction.clone());
    if (panel && id) hovers.set(panel, id);
    renderer.domElement.style.cursor = panel && id ? 'pointer' : 'grab';
  }
  for (const p of [stepPanel, hudPanel, calibPanel, S.crisis]) if (p && p.mesh.visible) p.setHover(hovers.get(p) || null);
  if (S.crisis && S.crisis.mesh.visible) S.crisis.tick();

  const m = stepPanel.mesh;
  if (m.visible && m.userData.pulse) m.scale.setScalar(m.userData.baseScale * (1 + 0.04 * Math.sin(time * 0.012)));
  else if (m.visible && m.userData.baseScale) m.scale.setScalar(m.userData.baseScale);

  updateHud();
  updateCopilot();
  renderer.render(scene, camera);
}

/* ─────────────────────────── Arranque ─────────────────────────── */

async function main() {
  $('engine-version').textContent = ENGINE_VERSION;
  wireButtons();
  voice.init();
  loadCopilotData().then((d) => { S.copilot.data = d; ensureCrisis(); }).catch(() => { /* sin copiloto: el simulacro sigue */ });
  await initSetup();
  initThree();
  initMouse();
  show('screen-setup');
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();

// Gancho de pruebas automatizadas (solo con ?debug en la URL).
if (new URLSearchParams(location.search).has('debug')) window.__sim = { S, handleAction };
