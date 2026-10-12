// Estado compartido del Panel de Crisis entre visores: versión con reloj lógico y fusión por campos.
//
// Antes ganaba el estado con la hora del dispositivo más reciente: un visor con el reloj adelantado se imponía
// siempre y dos actuaciones casi simultáneas se pisaban. Ahora:
//  · la versión es un contador lógico (Lamport) + el id del visor, independiente de la hora de cada gafa;
//  · escenarios e incidente: gana la versión más reciente;
//  · comunicaciones notificadas y convocatoria del comité: se acumulan, nunca se pierden.
// Funciones puras (sin DOM) para poder probarlas en Node.

const STATUS = ['active', 'contained', 'closed'];

// ¿La versión a es posterior a b? Empate de contador → desempata el id del visor (orden total, todos coinciden).
export function newerRev(a, b) {
  if (!a) return false;
  if (!b) return true;
  return a.n > b.n || (a.n === b.n && String(a.by) > String(b.by));
}

const isCats = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
  && Object.entries(o).every(([k, v]) => /^[A-Z0-9]{1,8}$/.test(k) && [1, 2, 3].includes(Number(v)));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Mensaje recibido de otro visor: solo se acepta con la forma esperada.
export function validShared(s) {
  if (!s || typeof s !== 'object') return false;
  if (!s.rev || !finite(s.rev.n) || s.rev.n < 0 || typeof s.rev.by !== 'string') return false;
  if (s.simNow != null && !finite(s.simNow)) return false;
  if (!isCats(s.selected)) return false;
  if (s.act !== null && s.act !== undefined) {
    if (typeof s.act !== 'object' || !isCats(s.act.scenarios) || !STATUS.includes(s.act.status)) return false;
  }
  if (!s.sent || typeof s.sent !== 'object' || !Object.values(s.sent).every(finite)) return false;
  if (s.convened != null && !finite(s.convened)) return false;
  return true;
}

// Devuelve { state, incomingWins, changed }. state lleva los campos compartidos ya fusionados.
export function mergeShared(local, incoming) {
  const incomingWins = newerRev(incoming.rev, local.rev);
  const base = incomingWins ? incoming : local;

  const sent = { ...(local.sent || {}) };
  let sentChanged = false;
  for (const [id, t] of Object.entries(incoming.sent || {})) {
    if (sent[id] == null || t < sent[id]) { sent[id] = t; sentChanged = true; } // se conserva la primera vez que se notificó
  }
  const conv = [local.convened, incoming.convened].filter((x) => x != null);
  const convened = conv.length ? Math.min(...conv) : null;
  const convChanged = convened !== (local.convened ?? null);

  return {
    incomingWins,
    changed: incomingWins || sentChanged || convChanged,
    state: {
      roundId: base.roundId ?? null,
      simNow: base.simNow,
      rev: base.rev,
      selected: { ...base.selected },
      act: base.act ? { ...base.act, scenarios: { ...base.act.scenarios } } : null,
      sent,
      convened,
    },
  };
}
