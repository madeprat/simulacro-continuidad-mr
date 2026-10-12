// Maqueta esquemática de la organización (formato crisis.site/1.0, fichero site.json del pack).
//
// Cada pack describe sus sedes, CPD, salas y proveedores como nodos de un plano abstracto, con:
//  · scenarios: escenarios del catálogo que afectan directamente al nodo (p. ej. E1 a una sede);
//  · services: servicios del catálogo que dependen de ese nodo (los mismos códigos SRV-… del copiloto);
//  · links: dependencias entre nodos (red, replicación, proveedor…).
// El estado de cada nodo sale de lo que el equipo declara y analiza en el Panel de Crisis, así la maqueta
// enseña el impacto «en su sitio» sin modelos 3D a medida: cambiar de organización es cambiar un JSON.
//
// Funciones puras (sin THREE ni DOM) para poder probarlas en Node.

export const SITE_SCHEMA = 'crisis.site/1.0';
export const NODE_TYPES = ['building', 'datacenter', 'room', 'provider'];

// Escala del plano: las coordenadas x/z van de -LIMIT a LIMIT (unidades libres, se ajustan al tamaño de la maqueta).
export const LIMIT = 4;

export function validateSite(site) {
  const errors = [];
  if (!site || typeof site !== 'object') return ['site.json vacío o ilegible.'];
  if (site.schema !== SITE_SCHEMA) errors.push(`esquema «${site.schema}» no soportado (se espera ${SITE_SCHEMA}).`);
  if (!site.name) errors.push('falta «name».');
  const nodes = Array.isArray(site.nodes) ? site.nodes : [];
  if (!nodes.length) errors.push('la maqueta no tiene nodos.');
  if (nodes.length > 16) errors.push(`demasiados nodos (${nodes.length}); el máximo legible es 16.`);
  const ids = new Set();
  const owner = {};
  for (const n of nodes) {
    const where = `nodo ${n.id || '?'}`;
    if (!/^[A-Z0-9-]{1,16}$/.test(n.id || '')) errors.push(`${where}: «id» debe ser de 1 a 16 mayúsculas, cifras o guiones.`);
    else if (ids.has(n.id)) errors.push(`${where}: id duplicado.`);
    ids.add(n.id);
    if (!NODE_TYPES.includes(n.type)) errors.push(`${where}: tipo «${n.type}» desconocido (${NODE_TYPES.join(', ')}).`);
    if (!n.label) errors.push(`${where}: falta «label».`);
    for (const k of ['x', 'z']) {
      if (typeof n[k] !== 'number' || Math.abs(n[k]) > LIMIT) errors.push(`${where}: «${k}» debe ser un número entre -${LIMIT} y ${LIMIT}.`);
    }
    if (n.type === 'building' && n.floors != null && !(Number.isInteger(n.floors) && n.floors >= 1 && n.floors <= 12)) {
      errors.push(`${where}: «floors» debe ser un entero de 1 a 12.`);
    }
    if (n.role && !['primary', 'backup'].includes(n.role)) errors.push(`${where}: «role» debe ser primary o backup.`);
    for (const sc of n.scenarios || []) if (!/^E\d+$/.test(sc)) errors.push(`${where}: escenario «${sc}» no válido.`);
    for (const sv of n.services || []) {
      if (typeof sv !== 'string' || !sv) errors.push(`${where}: código de servicio no válido.`);
      else if (owner[sv]) errors.push(`${where}: el servicio ${sv} ya depende de ${owner[sv]} (cada servicio va en un solo nodo).`);
      else owner[sv] = n.id;
    }
  }
  for (const l of site.links || []) {
    if (!ids.has(l.from) || !ids.has(l.to)) errors.push(`enlace ${l.from} → ${l.to}: los dos extremos deben ser nodos existentes.`);
  }
  return errors;
}

// Estado de cada nodo para una situación del panel.
// selected: { E3: 2, … } (escenarios declarados y su categoría); affected: servicios afectados de computeAffectedServices.
export function siteStatus(site, { selected = {}, affected = [] } = {}) {
  const hitCodes = new Set(Object.keys(selected || {}));
  const affectedCodes = new Set(affected.map((s) => s.codigo));
  const nodes = site.nodes.map((n) => {
    const direct = (n.scenarios || []).filter((sc) => hitCodes.has(sc));
    const services = n.services || [];
    const count = services.filter((sv) => affectedCodes.has(sv)).length;
    let status = 'ok';
    if (direct.length) status = 'hit';
    else if (count) status = 'impacted';
    else if (n.role === 'backup') status = 'standby';
    let line;
    if (status === 'hit') line = direct.map((sc) => `${sc} C${selected[sc]}`).join(' · ') + (count ? ` · ${count} serv.` : '');
    else if (status === 'impacted') line = `${count} de ${services.length} servicios afectados`;
    else if (status === 'standby') line = 'En espera (respaldo)';
    else line = services.length ? `Operativo · ${services.length} servicios` : 'Operativo';
    return { id: n.id, status, direct, affected: count, total: services.length, line };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const RANK = { hit: 3, impacted: 2, standby: 1, ok: 0 };
  const links = (site.links || []).map((l) => {
    const a = byId[l.from], b = byId[l.to];
    const worst = RANK[a.status] >= RANK[b.status] ? a.status : b.status;
    return { from: l.from, to: l.to, label: l.label || '', status: worst === 'standby' ? 'ok' : worst };
  });
  return {
    nodes, links,
    summary: { hit: nodes.filter((n) => n.status === 'hit').length, impacted: nodes.filter((n) => n.status === 'impacted').length },
  };
}
