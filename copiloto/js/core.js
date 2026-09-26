// Motor de cálculo del Copiloto de Continuidad.
// Funciones puras, sin DOM: las usan la página del copiloto (TV) y las pantallas flotantes de las gafas.
// Reproducen exactamente las reglas del copiloto original (afectación por umbral de probabilidad,
// puntuación de nivel, escaladas automáticas, pérdida acumulada, condición de desastre y comunicaciones).

export function parseNum(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let str = String(raw).trim().replace(/\s+/g, '');
  if (!str) return null;
  const hasComma = str.indexOf(',') >= 0;
  const hasDot = str.indexOf('.') >= 0;
  if (hasComma && hasDot) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) str = str.replace(/\./g, '').replace(',', '.');
    else str = str.replace(/,/g, '');
  } else if (hasComma) {
    str = str.replace(',', '.');
  }
  const n = parseFloat(str);
  return isFinite(n) ? n : null;
}

export function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

export function fmtHoras(h) {
  if (h === null || h === undefined || !isFinite(h)) return '—';
  if (h === 0) return '0 h';
  if (h < 1) return Math.round(h * 60) + ' min';
  return String(Math.round(h * 100) / 100).replace('.', ',') + ' h';
}

export function fmtEur(n) {
  const value = isFinite(n) ? n : 0;
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function fmtDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES');
}

export function fmtHMS(totalSeconds) {
  const segundos = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
}

export function parseResp(raw) {
  if (!raw) return { name: 'Sin responsable', email: '' };
  const m = String(raw).match(/^(.+?)\((.+?)\)$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: String(raw).trim(), email: '' };
}

export function probPct(label) {
  const s = String(label || '');
  if (s.indexOf('100%') >= 0) return 100;
  if (s.indexOf('75%') >= 0) return 75;
  if (s.indexOf('50%') >= 0) return 50;
  if (s.indexOf('25%') >= 0) return 25;
  return 0;
}

export function toneClassName(tone) {
  if (tone === 'critical') return 'critical';
  if (tone === 'danger') return 'danger';
  if (tone === 'warn') return 'warn';
  return 'ok';
}

// Igual que el original, pero sin distinguir tildes («Crítico» ≡ «CRITICO»).
export function impactTone(raw) {
  const value = String(raw || '').toUpperCase();
  const plain = value.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (plain.indexOf('CRITICO') >= 0) return { cls: 'critical', text: 'CRÍTICO' };
  if (plain.indexOf('ALTO') >= 0) return { cls: 'danger', text: 'ALTO' };
  if (plain.indexOf('MEDIO') >= 0) return { cls: 'warn', text: 'MEDIO' };
  return { cls: 'ok', text: value || 'BAJO' };
}

export function serviceTone(service, elapsed) {
  if (service.mtpd_s > 0 && elapsed >= service.mtpd_s) return 'critical';
  if (service.rto_s > 0 && elapsed >= service.rto_s) return 'danger';
  if (service.rto_s > 0 && elapsed >= service.rto_s * 0.75) return 'warn';
  return 'ok';
}

export function zoneText(service, elapsed) {
  const tone = serviceTone(service, elapsed);
  if (tone === 'critical') return 'MTPD superado';
  if (tone === 'danger') return 'En zona MTPD';
  if (tone === 'warn') return 'RTO crítico';
  return 'Dentro de RTO';
}

export function getTimerText(service, elapsed) {
  const rtoRest = service.rto_s - elapsed;
  const mtpdRest = service.mtpd_s - elapsed;
  if (service.mtpd_s > 0 && mtpdRest <= 0) return 'MTPD superado';
  if (service.rto_s > 0 && rtoRest <= 0) return service.mtpd_s > 0 ? fmtHMS(mtpdRest) + ' hasta MTPD' : 'RTO superado';
  if (service.rto_s > 0) return fmtHMS(rtoRest) + ' hasta RTO';
  return 'Sin RTO';
}

export function serviceProgress(service, elapsed) {
  if (!service.rto_s || service.rto_s <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((elapsed / service.rto_s) * 100)));
}

/* ─────────────── Escenarios y estrategias ─────────────── */

export function normalizeScenarioType(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.indexOf('hostil') >= 0) return 'hostil';
  if (value.indexOf('proveedor') >= 0) return 'proveedor';
  if (value.indexOf('persona') >= 0) return 'personas';
  return 'general';
}

export function normalizeScenarioCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function cleanScenarioName(name, code) {
  const text = String(name || '').trim();
  if (!text) return code;
  return text.replace(new RegExp('^' + code + '\\s*[-–—:]\\s*', 'i'), '').trim() || text;
}

// ctx = { scenarioRows, estrategias, config }
export function umbralProb(ctx) {
  return parseInt((ctx.config || {}).umbral_prob_pct || 75, 10);
}

function scenarioRowsMap(ctx) {
  const map = {};
  for (const row of ctx.scenarioRows || []) {
    const code = normalizeScenarioCode(row.codigo);
    if (code) { row.codigo = code; map[code] = row; }
  }
  return map;
}

export function scenarioMaster(code, ctx) {
  const normalized = normalizeScenarioCode(code);
  const row = scenarioRowsMap(ctx)[normalized] || {};
  const cfg = ((ctx.config || {}).scenarios || {})[normalized] || {};
  const U = umbralProb(ctx);
  const est = ctx.estrategias && ctx.estrategias[normalized];
  return {
    code: normalized,
    idactivo: row.idactivo || cfg.idactivo || '',
    title: row.nombre || cfg.title || normalized,
    short: row.nombre ? cleanScenarioName(row.nombre, normalized) : (cfg.short || cleanScenarioName(cfg.title || normalized, normalized)),
    icon: cfg.icon || '•',
    pattern: cfg.pattern || cleanScenarioName(row.nombre || cfg.title || normalized, normalized),
    strategies: est && est.length ? est.map((s) => s.codigo) : (row.strategies || cfg.strategies || []),
    tipo_calculo: normalizeScenarioType(row.tipo_calculo || cfg.tipo_calculo || ''),
    nivel_base: parseInt(row.nivel_base || cfg.nivel_base || 1, 10) || 1,
    nivel_comite: parseInt(row.nivel_comite || cfg.nivel_comite || 3, 10) || 3,
    umbral_prob_servicio: parseInt(row.umbral_prob_servicio || cfg.umbral_prob_servicio || U, 10) || U,
    activo: String(row.activo == null ? 1 : row.activo) !== '0',
    categoria_1: row.categoria_1 || cfg.categoria_1 || '',
    categoria_2: row.categoria_2 || cfg.categoria_2 || '',
    categoria_3: row.categoria_3 || cfg.categoria_3 || '',
  };
}

export function scenarioCatalog(ctx) {
  let codes = Object.keys(scenarioRowsMap(ctx));
  if (!codes.length) codes = Object.keys((ctx.config || {}).scenarios || {}).map(normalizeScenarioCode);
  codes = codes.filter(Boolean).sort((a, b) => (a > b ? 1 : -1));
  return codes.map((c) => scenarioMaster(c, ctx)).filter((s) => s.activo);
}

// selected = { E3: categoría, E6: categoría, ... }
export function uniqueStrategies(selected, ctx) {
  const strategiesCfg = (ctx.config || {}).strategies || {};
  const map = {};
  const allScenarioCodes = Object.keys(ctx.estrategias || {});
  for (const scenCode of allScenarioCodes) {
    for (const es of ctx.estrategias[scenCode] || []) {
      if (!es.codigo) continue;
      if (!map[es.codigo]) {
        const nombre = (es.nombre || es.codigo).replace(/^[A-Z0-9]+-/, '').trim() || es.codigo;
        map[es.codigo] = {
          code: es.codigo, idactivo: es.id || '', title: nombre,
          descripcion: (es.descripcion || '').replace(/^[A-Z0-9]+-\s*/, '').trim(),
          detail: (strategiesCfg[es.codigo] || {}).detail || '',
          scenarios: [], activeScenarios: [],
        };
      }
      if (map[es.codigo].scenarios.indexOf(scenCode) < 0) map[es.codigo].scenarios.push(scenCode);
    }
  }
  if (!allScenarioCodes.length) {
    for (const raw of Object.keys(selected)) {
      const cfgCode = normalizeScenarioCode(raw);
      for (const cst of scenarioMaster(cfgCode, ctx).strategies || []) {
        if (!map[cst]) map[cst] = { code: cst, idactivo: '', title: (strategiesCfg[cst] || {}).title || cst, detail: '', scenarios: [cfgCode], activeScenarios: [] };
        else if (map[cst].scenarios.indexOf(cfgCode) < 0) map[cst].scenarios.push(cfgCode);
      }
    }
  }
  const sel = Object.keys(selected);
  for (const code of Object.keys(map)) map[code].activeScenarios = map[code].scenarios.filter((sc) => sel.indexOf(sc) >= 0);
  return Object.values(map).sort((a, b) => (a.code > b.code ? 1 : -1));
}

/* ─────────────── Afectación, nivel y presión ─────────────── */

export function computeAffectedServices(services, selected, ctx) {
  const codes = Object.keys(selected).map(normalizeScenarioCode);
  const filtered = [];
  for (const row of services) {
    const matchedScenarios = [];
    let maxProb = 0;
    let maxBaseLevel = 1;
    for (const code of codes) {
      const scenario = scenarioMaster(code, ctx);
      const prob = probPct(row[code.toLowerCase()] || '');
      maxProb = Math.max(maxProb, prob);
      if (prob >= scenario.umbral_prob_servicio) {
        matchedScenarios.push(code);
        maxBaseLevel = Math.max(maxBaseLevel, scenario.nivel_base || 1);
      }
    }
    if (!matchedScenarios.length) continue;
    const svc = { ...row };
    svc.rto_h = parseNum(row.rto) || 0;
    svc.mtpd_h = parseNum(row.mtpd) || 0;
    svc.rpo_h = parseNum(row.rpo) || 0;
    svc.perdida_h = parseNum(row.perdidah) || 0;
    svc.rto_s = Math.round(svc.rto_h * 3600);
    svc.mtpd_s = Math.round(svc.mtpd_h * 3600);
    svc.rpo_s = Math.round(svc.rpo_h * 3600);
    svc.responsable = parseResp(row.n_responsable);
    svc.max_prob = maxProb;
    svc.matchedScenarios = matchedScenarios;
    svc.base_level = maxBaseLevel;
    svc.impact = impactTone(row.impactoreputacional);
    svc.is_critico = svc.impact.cls === 'critical' || (svc.rto_h > 0 && svc.rto_h <= 2);
    filtered.push(svc);
  }
  filtered.sort((a, b) => {
    if (a.is_critico !== b.is_critico) return a.is_critico ? -1 : 1;
    if (a.rto_h !== b.rto_h) return a.rto_h - b.rto_h;
    if (a.rpo_h !== b.rpo_h) return a.rpo_h - b.rpo_h;
    return (b.perdida_h || 0) - (a.perdida_h || 0);
  });
  return filtered;
}

export const LEVEL_TITLES = { 1: 'Nivel 1 · Seguimiento operativo', 2: 'Nivel 2 · Interrupción significativa', 3: 'Nivel 3 · Escalar a comité de continuidad' };
export const LEVEL_NOTES = {
  1: 'La situación es manejable. Mantén el seguimiento activo y monitoriza la evolución.',
  2: 'La interrupción es significativa. Coordina con los responsables de servicio y revisa el reloj periódicamente.',
  3: 'La gravedad exige activar el comité de continuidad o iniciar el plan de recuperación.',
};

// Devuelve el resumen de nivel o null si no hay escenarios seleccionados.
export function computeIncidentLevel({ selected, affected, elapsed, lastLoss, ctx }) {
  const selectedData = Object.keys(selected).map((c) => scenarioMaster(c, ctx));
  if (!selectedData.length) return null;
  const umbralPerdida = parseFloat((ctx.config || {}).umbral_perdida_eur || 5000);
  let levelBase = 1;
  let committeeThreshold = 3;
  let hasHostil = false, hasProveedor = false, hasPersonas = false;
  for (const sd of selectedData) {
    const catSelected = (selected[sd.code] && parseInt(selected[sd.code], 10)) || 1;
    const scenarioNivelBase = parseInt(sd.nivel_base || 1, 10) || 1;
    levelBase = Math.max(levelBase, Math.min(3, scenarioNivelBase + (catSelected - 1)));
    committeeThreshold = Math.max(committeeThreshold, sd.nivel_comite || 3);
    hasHostil = hasHostil || sd.tipo_calculo === 'hostil';
    hasProveedor = hasProveedor || sd.tipo_calculo === 'proveedor';
    hasPersonas = hasPersonas || sd.tipo_calculo === 'personas';
  }
  const count = affected.length;
  let minRto = null, totalLossHour = 0, criticalCount = 0, exceededMtpd = 0;
  for (const svc of affected) {
    totalLossHour += svc.perdida_h || 0;
    if (svc.is_critico) criticalCount++;
    if (svc.rto_h > 0 && (minRto === null || svc.rto_h < minRto)) minRto = svc.rto_h;
    if (svc.mtpd_s > 0 && elapsed >= svc.mtpd_s) exceededMtpd++;
  }
  let score = levelBase;
  const points = [{ label: 'Nivel base del escenario', value: levelBase }];
  const add = (cond, label) => { if (cond) { score += 0.5; points.push({ label, value: 0.5 }); } };
  add(count >= 3, '≥ 3 servicios afectados');
  add(count >= 8, '≥ 8 servicios afectados');
  add(count >= 15, '≥ 15 servicios afectados');
  add(minRto !== null && minRto <= 4, 'RTO más exigente ≤ 4 h');
  add(minRto !== null && minRto <= 2, 'RTO más exigente ≤ 2 h');
  add(totalLossHour >= 1500, 'Pérdida/hora ≥ 1.500 €');
  add(totalLossHour >= 5000, 'Pérdida/hora ≥ 5.000 €');
  add(criticalCount >= 1, '≥ 1 servicio crítico');
  add(criticalCount >= 4, '≥ 4 servicios críticos');
  add(hasHostil || hasProveedor || hasPersonas, 'Escenario hostil / proveedor / personas');

  const reasons = [];
  if (levelBase > 1) reasons.push('Nivel base efectivo: N' + levelBase + ' (categoría seleccionada en escenarios)');
  if (count) reasons.push(count + ' servicios afectados');
  if (minRto !== null) reasons.push('RTO más exigente: ' + fmtHoras(minRto));
  if (totalLossHour > 0) reasons.push('Pérdida estimada/hora: ' + fmtEur(totalLossHour));

  const cat3Scenarios = selectedData.filter((sd) => parseInt(selected[sd.code] || 1, 10) >= 3).map((sd) => sd.code);
  const hardTriggers = [];
  if (cat3Scenarios.length) hardTriggers.push('Categoría 3 declarada en: ' + cat3Scenarios.join(', '));
  if (exceededMtpd > 0) hardTriggers.push(exceededMtpd + ' servicio(s) superan MTPD');
  if (lastLoss >= umbralPerdida && lastLoss > 0) hardTriggers.push('Pérdida acumulada supera el umbral configurado');

  let level = 1;
  if (score >= 2.5) level = 2;
  if (score >= 4) level = 3;
  if (hardTriggers.length) level = 3;
  return {
    level, score, points, title: LEVEL_TITLES[level], note: LEVEL_NOTES[level], baseLevel: levelBase,
    committeeThreshold, affected: count, minRto, totalLossHour, criticalCount, exceededMtpd,
    hardTriggers, reasons, committeeRecommended: level >= committeeThreshold,
  };
}

// Pérdida acumulada, tono global del reloj y condición de desastre (tickMode2 del original).
export function computePressure(affected, elapsed, config = {}) {
  const umbralPerdida = parseFloat(config.umbral_perdida_eur || 5000);
  const umbralCriticos = parseInt(config.umbral_criticos_mtpd || 1, 10);
  let totalLoss = 0, criticosMtpd = 0, overallTone = 'ok';
  let minRto = null;
  for (const svc of affected) {
    totalLoss += (svc.perdida_h || 0) * (elapsed / 3600);
    if (svc.is_critico && svc.mtpd_s > 0 && elapsed >= svc.mtpd_s) criticosMtpd++;
    if (svc.rto_h > 0 && (minRto === null || svc.rto_h < minRto)) minRto = svc.rto_h;
    const tone = serviceTone(svc, elapsed);
    if (tone === 'critical') overallTone = 'critical';
    else if (tone === 'danger' && overallTone !== 'critical') overallTone = 'danger';
    else if (tone === 'warn' && overallTone === 'ok') overallTone = 'warn';
  }
  const counts = { ok: 0, warn: 0, danger: 0, critical: 0 };
  for (const svc of affected) counts[serviceTone(svc, elapsed)]++;
  return {
    totalLoss, criticosMtpd, overallTone, counts, minRto,
    disaster: totalLoss >= umbralPerdida || criticosMtpd >= umbralCriticos,
  };
}

export function pressureLabel({ status = 'active', disaster = false, overallTone = 'ok' }) {
  if (status === 'contained') return { text: 'Sesión pausada', cls: 'warn' };
  if (status === 'closed') return { text: 'Incidente cerrado', cls: 'ok' };
  if (disaster || overallTone === 'critical') return { text: 'Umbral de desastre', cls: 'critical' };
  if (overallTone === 'danger') return { text: 'RTO comprometido', cls: 'danger' };
  if (overallTone === 'warn') return { text: 'Tensión creciente', cls: 'warn' };
  return { text: 'Ventana operativa', cls: 'ok' };
}

/* ─────────────── Comunicaciones obligatorias ─────────────── */

export const COMMS_TABLE = [
  // SEGURIDAD
  { id: 'seg-1', ctx: ['seguridad'], order: 10, when: 'Ahora', bucket: 'now', mandatory: true, title: 'Activar la gestión interna del incidente', quien: 'Dirección de Seguridad / CISO / Comité de Seguridad', canal: 'Canal interno de incidentes', plazo: 'Sin dilación', base: 'Política de seguridad corporativa', evidencia: 'Activación formal, responsables designados, cronología', accion: 'escalada_interna', color: 'critical', mail_asunto: 'Activación de gestión de incidente de seguridad', mail_cuerpo: 'Hay un incidente de seguridad activo que requiere activación inmediata del protocolo interno. Por favor, confirmad activación del equipo de respuesta, designación de responsables y apertura del ticket formal.' },
  { id: 'seg-2', ctx: ['seguridad', 'publico'], order: 30, when: 'Ahora', bucket: 'now', mandatory: true, title: 'Notificar al cliente público afectado', quien: 'POC con validación de Dirección de Seguridad', canal: 'Canal formal de cliente', plazo: 'Sin dilación', base: 'ENS art. 13.5', evidencia: 'Aviso inicial, hora, destinatario, contenido, acuse de recibo', accion: 'mailto', color: 'critical', mail_asunto: 'Aviso de incidente que puede afectar al servicio prestado', mail_cuerpo: 'Se ha detectado un incidente que puede afectar al servicio que prestamos. Proceded a notificar al contacto del cliente público asignado indicando: hora de detección, descripción breve sin datos técnicos sensibles, estado actual y próximos pasos.' },
  { id: 'seg-3', ctx: ['seguridad', 'publico'], order: 40, when: 'Ahora', bucket: 'now', mandatory: true, title: 'Notificar a INCIBE-CERT', quien: 'Dirección de Seguridad / CISO', canal: 'Canal oficial INCIBE-CERT', plazo: 'Sin dilación', base: 'ENS art. 33.7', evidencia: 'Comunicación enviada, hora, acuse, clasificación del impacto', accion: 'mailto', color: 'critical', mail_asunto: 'Solicitud de notificación a INCIBE-CERT', mail_cuerpo: 'El incidente activo afecta a servicios prestados a entidades públicas. Proceded a notificar a INCIBE-CERT con la clasificación del incidente, el alcance estimado y la relación con los clientes públicos afectados.' },
  { id: 'seg-4', ctx: ['seguridad', 'publico'], order: 50, when: 'Ahora', bucket: 'now', mandatory: true, title: 'Apertura de caso en LUCÍA (RNS/CCN-CERT)', quien: 'Equipo autorizado por Dirección de Seguridad', canal: 'LUCÍA', plazo: 'Sin dilación', base: 'RNS — uso obligatorio', evidencia: 'Caso creado, tiempos, actualizaciones, evidencias adjuntas', accion: 'link_lucia', color: 'critical', mail_asunto: 'Apertura de caso en LUCÍA para incidente activo', mail_cuerpo: 'El incidente requiere apertura de caso en LUCÍA para seguimiento con CCN-CERT y la Red Nacional de SOCs. Proceded a crear el caso con la información disponible y mantenerlo actualizado durante la gestión.' },
  { id: 'seg-5', ctx: ['seguridad'], order: 120, when: 'Si hay indicios de delito', bucket: 'next', mandatory: false, title: 'Valorar denuncia ante autoridades', quien: 'Director de Seguridad / Legal', canal: 'Autoridad policial / canal legal', plazo: 'Cuando haya base suficiente', base: 'Base penal / procesal interna', evidencia: 'Evidencias forenses, cadena de custodia, cronología, valoración legal', accion: 'info', color: 'warn', mail_asunto: 'Valoración de denuncia por indicios de delito', mail_cuerpo: 'Existen indicios que podrían justificar una denuncia. Solicitamos valoración legal urgente para determinar si procede y en qué plazo debe presentarse, con preservación de la cadena de custodia de evidencias.' },
  // CLIENTE PÚBLICO
  { id: 'pub-1', ctx: ['publico'], order: 60, when: 'Durante el incidente', bucket: 'now', mandatory: false, title: 'Coordinación táctica en mensajería RNS', quien: 'Equipo operativo SOC autorizado', canal: 'Element (mensajería RNS)', plazo: 'Mientras dure el incidente', base: 'Requisito de la RNS', evidencia: 'Mensajes enviados, hora, destinatarios, decisiones derivadas', accion: 'info', color: 'warn', mail_asunto: 'Coordinación activa en mensajería RNS (Element)', mail_cuerpo: 'Es necesario mantener la coordinación táctica activa en la mensajería de la RNS. Asegurad que el equipo autorizado está conectado y actualizando el estado del incidente en los canales correspondientes.' },
  { id: 'pub-2', ctx: ['publico'], order: 130, when: 'Post-incidente', bucket: 'post', mandatory: false, title: 'Compartir lecciones aprendidas en REYES', quien: 'Equipo de respuesta con validación de Seguridad', canal: 'REYES', plazo: 'Tras el análisis', base: 'CCN-STIC 896 — SR.IRT.6', evidencia: 'Informe técnico, lecciones aprendidas, inteligencia compartida', accion: 'info', color: 'ok', mail_asunto: 'Compartir lecciones aprendidas post-incidente en REYES', mail_cuerpo: 'Una vez cerrado y analizado el incidente, proceded a compartir las lecciones aprendidas e inteligencia relevante en la plataforma REYES, conforme a los requisitos de la RNS.' },
  // PRIVACIDAD
  { id: 'priv-1', ctx: ['privacidad'], order: 90, when: 'Ahora', bucket: 'now', mandatory: true, title: 'Notificar la brecha al cliente (si somos encargados)', quien: 'Dirección de Seguridad + DPD + POC', canal: 'Canal formal de cliente + procedimiento de brechas', plazo: 'Sin dilación indebida', base: 'RGPD art. 33.2', evidencia: 'Hora de conocimiento, categorías de datos, evaluación inicial, acuse del responsable', accion: 'mailto', color: 'critical', mail_asunto: 'Notificación de brecha de datos personales al responsable del tratamiento', mail_cuerpo: 'Se ha detectado una posible brecha de datos personales. Como encargados del tratamiento, debemos notificarla sin dilación al cliente responsable. Proceded a contactar al DPD del cliente con: descripción de la brecha, categorías de datos afectados, estimación de afectados y medidas tomadas.' },
  { id: 'priv-2', ctx: ['privacidad'], order: 100, when: 'Antes de 72 h', bucket: 'deadline', mandatory: true, plazo_horas: 72, title: 'Notificar la brecha a la AEPD (si somos responsables)', quien: 'Responsable del tratamiento + DPD + Dirección de Seguridad', canal: 'Canal de brechas AEPD', plazo: 'Máximo 72 h desde el conocimiento', base: 'RGPD art. 33.1', evidencia: 'Evaluación de riesgo, fecha de constancia, medidas adoptadas, motivo de retraso si aplica', accion: 'mailto', color: 'danger', mail_asunto: 'Notificación de brecha de seguridad a la AEPD — plazo 72 h', mail_cuerpo: 'Tenemos la obligación de notificar esta brecha a la AEPD antes de que transcurran 72 horas desde que tuvimos conocimiento. Proceded a preparar y enviar la notificación incluyendo: descripción de la brecha, datos y personas afectadas, consecuencias probables y medidas correctoras adoptadas.' },
  { id: 'priv-3', ctx: ['privacidad'], order: 110, when: 'Si hay alto riesgo para los afectados', bucket: 'deadline', mandatory: true, title: 'Comunicar la brecha a los interesados', quien: 'Responsable del tratamiento + DPD / Legal / Seguridad', canal: 'Canal directo a los afectados', plazo: 'Sin dilación si el riesgo es alto', base: 'RGPD art. 34', evidencia: 'Texto comunicado, fecha, colectivos afectados, mitigaciones ofrecidas', accion: 'mailto', color: 'danger', mail_asunto: 'Comunicación a los interesados afectados por la brecha', mail_cuerpo: 'La brecha detectada presenta un alto riesgo para los derechos y libertades de los afectados. Es necesario comunicárselo sin dilación. Preparad la comunicación con lenguaje claro, no técnico, indicando: qué ha ocurrido, qué datos están afectados, qué medidas se están tomando y cómo pueden protegerse.' },
];

export function getCommsForCtx(ctx) {
  return COMMS_TABLE.filter((c) => c.ctx.indexOf(ctx) !== -1).sort((a, b) => a.order - b.order);
}

export function getCommsStatus(item, elapsedMin) {
  if (elapsedMin === null || elapsedMin === undefined || !isFinite(elapsedMin)) return { key: 'planning', label: 'Sin cronómetro' };
  if (item.plazo_horas) {
    const remainMin = item.plazo_horas * 60 - elapsedMin;
    if (remainMin < 0) return { key: 'overdue', label: 'Plazo vencido' };
    if (remainMin <= 180) return { key: 'due', label: Math.round(remainMin) + ' min' };
    return { key: 'scheduled', label: Math.round(remainMin / 60) + ' h' };
  }
  if (item.bucket === 'post') return { key: 'post', label: 'Post-incidente' };
  if (item.bucket === 'next') return { key: 'soon', label: 'Cuando corresponda' };
  return { key: 'due', label: 'Ahora' };
}

// Cuenta atrás RGPD de 72 h desde el inicio (onset) del incidente.
export function rgpdCountdown(onsetMs, nowMs) {
  const remMs = onsetMs + 72 * 3600000 - nowMs;
  if (remMs <= 0) return { expired: true, hours: 0, minutes: 0, cls: 'critical' };
  const hours = Math.floor(remMs / 3600000);
  const minutes = Math.floor((remMs % 3600000) / 60000);
  return { expired: false, hours, minutes, cls: hours < 12 ? 'danger' : 'warn' };
}

/* ─────────────── Instantánea completa (para las gafas) ─────────────── */

// state = { selected: {E3:1,...}, onsetMs, nowMs, status }
export function snapshot(data, state) {
  const ctx = { scenarioRows: data.scenarios, estrategias: data.estrategias, config: data.config };
  const elapsed = Math.max(0, (state.nowMs - state.onsetMs) / 1000);
  const affected = computeAffectedServices(data.services, state.selected, ctx);
  const pressure = computePressure(affected, elapsed, data.config);
  const level = computeIncidentLevel({ selected: state.selected, affected, elapsed, lastLoss: pressure.totalLoss, ctx });
  const strategies = uniqueStrategies(state.selected, ctx);
  return {
    elapsed, affected, pressure, level, strategies,
    label: pressureLabel({ status: state.status, disaster: pressure.disaster, overallTone: pressure.overallTone }),
    rgpd: rgpdCountdown(state.onsetMs, state.nowMs),
    scenarios: Object.keys(state.selected).map((c) => ({ ...scenarioMaster(c, ctx), category: state.selected[c] })),
  };
}

/* ─────────────── Tiempo de ejercicio ─────────────── */

// Medianoche local del día del ejercicio (por defecto, hoy).
export function exerciseBase(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// «D0 07:33» → milisegundos (día relativo + hora local sobre la base del ejercicio).
export function exerciseTime(spec, baseMs) {
  const m = /^D(\d+)\s+(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return null;
  return baseMs + parseInt(m[1], 10) * 86400000 + (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60000;
}

// Estado del copiloto al inicio de una ronda del pack (bloque «copilot» de rounds.json).
export function roundCopilotState(round, baseMs) {
  const c = round && round.copilot;
  if (!c) return null;
  return {
    nowMs: exerciseTime(c.clock, baseMs),
    createdMs: exerciseTime(c.declared || c.clock, baseMs),
    onsetMs: exerciseTime(c.onset || c.declared || c.clock, baseMs),
    selected: { ...(c.scenarios || {}) },
    status: c.status || 'active',
  };
}
