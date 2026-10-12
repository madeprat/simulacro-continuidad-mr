// Disposición del centro de mando: los paneles se colocan en un arco alrededor de cada participante,
// no en las paredes de la sala. Así el simulacro funciona igual en una sala compartida, en casa o en un
// despacho, sin calibrar nada: basta con mirar al frente y «Recentrar».
//
// Funciones puras (sin THREE ni DOM) para poder probarlas en Node.
// Convenio: ángulo positivo = a la derecha del participante; dy = altura relativa a los ojos (m);
// tilt = inclinación hacia atrás en grados (paneles «sobre la mesa»).

export const SLOTS = {
  center: { angle: 0, dist: 1.15, dy: -0.15, scale: 1 }, // lectura principal: injects, decisiones
  desk: { angle: 0, dist: 0.8, dy: -0.5, tilt: -35, scale: 0.75 }, // documentos «sobre la mesa»
  side: { angle: 30, dist: 1.25, dy: -0.05, scale: 0.9 }, // llamadas y avisos que llegan «de fuera»
  action: { angle: -9, dist: 1.1, dy: -0.1, scale: 0.8 }, // instrucción junto al Panel de Crisis
  crisis: { angle: -58, dist: 1.3, dy: 0, scale: 0.8 }, // Panel de Crisis a la izquierda
  cards: { angle: 68, dist: 1.15, dy: 0.02, scale: 0.85 }, // tarjetas de resumen del rol a la derecha
  model: { angle: -45, dist: 0.95, dy: -0.55, scale: 1 }, // maqueta de la organización, «sobre la mesa» bajo el Panel de Crisis
};

// Anclas del formato de pack (pensadas para una sala) → posiciones del arco.
export const ANCHOR_SLOT = { FRONT: 'center', TABLE: 'desk', DOOR: 'side', TV: 'action' };

export function slotFor(anchorId) {
  return ANCHOR_SLOT[anchorId] || 'center';
}

// rig = { pos: {x,y,z} (ojos), fwd: {x,z} (frente horizontal, normalizado) }
// compress < 1 cierra el arco y far > 1 lo aleja (pantalla de ordenador: menos campo de visión que unas gafas).
export function slotPose(rig, slotName, { compress = 1, far = 1 } = {}) {
  const s = SLOTS[slotName] || SLOTS.center;
  const a = (s.angle * compress * Math.PI) / 180;
  const fx = rig.fwd.x, fz = rig.fwd.z;
  const rx = -fz, rz = fx; // derecha del participante
  const dx = fx * Math.cos(a) + rx * Math.sin(a);
  const dz = fz * Math.cos(a) + rz * Math.sin(a);
  return {
    x: rig.pos.x + dx * s.dist * far,
    y: rig.pos.y + s.dy,
    z: rig.pos.z + dz * s.dist * far,
    tilt: s.tilt || 0,
    scale: s.scale,
    // Hacia dónde mira el panel: al participante.
    face: { x: rig.pos.x, z: rig.pos.z },
  };
}

// Ancho angular (grados) que ocupa un panel de anchura w (m) en un hueco del arco.
export function angularWidth(slotName, widthM) {
  const s = SLOTS[slotName] || SLOTS.center;
  return (2 * Math.atan((widthM * s.scale) / 2 / s.dist) * 180) / Math.PI;
}
