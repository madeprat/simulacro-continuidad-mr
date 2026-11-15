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

export const FACILITATOR_ROLE = 'FAC';
export const CONTROL_ACTIONS = ['start', 'goto', 'pause', 'resume', 'message'];
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
