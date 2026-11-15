// Protocolo de la consola del facilitador.
//
// La consola entra en la misma sala de sincronización que los visores con el rol especial FAC y envía mensajes
// «control». Este módulo no depende del navegador: lo usan la consola, los visores y las pruebas.
//
// Órdenes:
//   start    los visores que esperan en «Preparado» empiezan la cuenta atrás a la vez
//   goto     todos los visores saltan a un punto del ejercicio: inicio de ronda, inject o final
//   pause    el ejercicio se detiene en todos los visores
//   resume   el ejercicio continúa donde estaba cada visor
//   message  aviso libre del facilitador, para todos o para un rol
//   collect  los visores envían a la consola su registro de evidencias (también lo envían solos al terminar)
//
// Los visores responden con mensajes «log»: el JSON exportado de su sesión, idéntico al que se descarga, para que el
// debrief compruebe su cadena de integridad igual que con un fichero.

export const FACILITATOR_ROLE = 'FAC';
export const CONTROL_ACTIONS = ['start', 'goto', 'pause', 'resume', 'message', 'collect'];
export const MESSAGE_MAX = 400;

// Nombre legible de un rol en la sala (el facilitador no es un rol del pack).
export function peerName(role) {
  return role === FACILITATOR_ROLE ? 'Facilitador' : role;
}

// Puntos que el facilitador puede lanzar, en el orden del ejercicio.
export function controlTargets(pack) {
  const out = [];
  for (const round of pack.rounds) {
    out.push({ kind: 'round', round_id: round.id, label: `Ronda ${round.number} · ${round.title}` });
    for (const e of round.events || []) {
      out.push({ kind: 'inject', round_id: round.id, inject_id: e.id, label: `${e.id} · ${e.title || e.source || e.type}` });
    }
  }
  out.push({ kind: 'end', label: 'Final del ejercicio' });
  return out;
}

// Índice del paso (buildSteps) que corresponde a un destino, o -1 si no existe en este pack.
export function resolveTarget(steps, target) {
  if (!target) return -1;
  if (target.kind === 'end') return steps.findIndex((s) => s.kind === 'end');
  if (target.kind === 'round') return steps.findIndex((s) => s.kind === 'round_intro' && s.round.id === target.round_id);
  if (target.kind === 'inject') {
    return steps.findIndex((s) => s.kind === 'event' && s.round.id === target.round_id && s.event.id === target.inject_id);
  }
  return -1;
}

// Datos de una orden lista para enviar con SyncHub.send('control', …).
export function controlMessage(pack, action, extra = {}) {
  const data = { action, exercise_id: pack.manifest.exercise_id, version: pack.manifest.version };
  if (action === 'goto') data.target = extra.target;
  if (action === 'message') {
    data.text = String(extra.text || '').trim().slice(0, MESSAGE_MAX);
    data.to = extra.to || 'ALL';
  }
  return data;
}

// Orden recibida en un visor: solo se acepta del facilitador, para el mismo ejercicio y con datos válidos.
// Devuelve { action, target?, text?, to? } o null. Los avisos dirigidos a otro rol se descartan.
export function acceptControl(pack, msg, localRole) {
  if (!msg || msg.type !== 'control' || msg.from !== FACILITATOR_ROLE) return null;
  const d = msg.data || {};
  if (!CONTROL_ACTIONS.includes(d.action) || d.exercise_id !== pack.manifest.exercise_id) return null;
  if (d.action === 'goto') {
    const t = d.target;
    if (!t || !['round', 'inject', 'end'].includes(t.kind)) return null;
    return { action: 'goto', target: t };
  }
  if (d.action === 'message') {
    const text = String(d.text || '').trim().slice(0, MESSAGE_MAX);
    if (!text) return null;
    const to = d.to || 'ALL';
    if (to !== 'ALL' && to !== localRole) return null;
    return { action: 'message', text, to };
  }
  return { action: d.action };
}

// Datos de un mensaje «log» que envía un visor con su registro (Session.toJSON()).
export function logMessage(session) {
  const text = session.toJSON();
  return {
    file: session.fileBase() + '.json', text,
    exercise_id: session.data.exercise.id, session_id: session.data.session_id,
    completed: !!session.data.completed_at, events: session.data.events.length, head: session.head,
  };
}

// Registro recibido en la consola: solo de un rol del pack, para este ejercicio y esta sesión, y que el rol del
// registro sea el del visor que lo envía. Devuelve { role, file, text, completed, events, head } o null.
export function acceptLog(pack, msg, sessionId) {
  if (!msg || msg.type !== 'log' || !msg.data || typeof msg.data.text !== 'string') return null;
  if (!pack.roles.some((r) => r.id === msg.from)) return null;
  let data;
  try { data = JSON.parse(msg.data.text); } catch { return null; }
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  if (!data || data.exercise?.id !== pack.manifest.exercise_id || !same(data.session_id, sessionId) || data.local_role !== msg.from) return null;
  const events = Array.isArray(data.events) ? data.events.length : 0;
  const file = /^[\w.-]+\.json$/.test(msg.data.file || '') ? msg.data.file : `${data.exercise.id}_${data.session_id}_${msg.from}.json`.replace(/[^\w.-]+/g, '_');
  return { role: msg.from, file, text: msg.data.text, completed: !!data.completed_at, events, head: data.integrity?.head || '' };
}

// Clave con la que la consola deja los registros al debrief (mismo origen, localStorage).
export const HANDOFF_KEY = 'simulacro:registros-desde-consola';
