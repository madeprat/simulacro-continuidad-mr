// Panel de Crisis virtual: el Copiloto de Continuidad dentro de la realidad mixta.
// Sustituye a la TV: una pantalla grande en la pared de la sala, operable con el rayo del mando o la mano.
// Usa el mismo motor de cálculo que la versión web (copiloto/js/core.js) y registra cada actuación como evidencia.
import * as THREE from '../vendor/three.module.min.js';
import * as core from '../copiloto/js/core.js';
import { THEME, makeTexture, wrap, roundRect } from './panel.js';

const W = 1920;
const H = 1200;
const WIDTH_M = 1.6;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TONE = { ok: THEME.green, warn: THEME.amber, danger: '#fb923c', critical: THEME.red };
const LEVEL_COLOR = { 1: THEME.green, 2: THEME.amber, 3: THEME.red };

export const TABS = [
  { id: 'activation', icon: '⚡', label: 'Activación' },
  { id: 'impact', icon: '📊', label: 'Impacto' },
  { id: 'level', icon: '🎯', label: 'Nivel' },
  { id: 'services', icon: '🧭', label: 'Servicios RTO' },
  { id: 'committee', icon: '👥', label: 'Comité' },
  { id: 'comms', icon: '📡', label: 'Comunicaciones' },
];
const CTX = [{ id: 'seguridad', label: 'Incidente de seguridad' }, { id: 'publico', label: 'Afecta a cliente público' }, { id: 'privacidad', label: 'Datos personales en riesgo' }];
const SVC_PAGE = 8;

// Traduce la pestaña que nombra una actuación del pack («⚡ Activación», «🗂 Historial»…) a una pestaña del panel.
export function tabFor(label = '') {
  const l = label.toLowerCase();
  if (l.includes('activ')) return 'activation';
  if (l.includes('impacto') || l.includes('historial')) return 'impact';
  if (l.includes('nivel')) return 'level';
  if (l.includes('servicio')) return 'services';
  if (l.includes('comit')) return 'committee';
  if (l.includes('comunica')) return 'comms';
  return null;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export class CrisisPanel {
  constructor({ data, onEvent = () => {} }) {
    this.data = data;
    this.ctx0 = { scenarioRows: data.scenarios, estrategias: data.estrategias, config: data.config };
    this.onEvent = onEvent;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = makeTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH_M, WIDTH_M * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.renderOrder = 5;
    this.mesh.userData.panel = this;
    this.widthM = WIDTH_M;
    this.heightM = WIDTH_M * H / W;
    this.regions = [];
    this.hover = null;
    this.state = { tab: 'activation', selected: {}, act: null, svcPage: 0, commsCtx: 'seguridad', commsItem: null, sent: {}, convened: null, notice: '' };
    this.base = null;
    this.roundStartReal = Date.now();
    this.lastSecond = -1;
    this.draw();
  }

  /* ─────────────── Tiempo y estado ─────────────── */

  now() {
    return this.base && this.base.nowMs != null ? this.base.nowMs + (Date.now() - this.roundStartReal) : Date.now();
  }

  // Estado de referencia al empezar una ronda del pack (así los tres visores parten del mismo panel).
  setRoundBaseline(st, roundLabel) {
    if (!st) return;
    this.base = st;
    this.roundStartReal = Date.now();
    const codes = Object.keys(st.selected || {});
    this.state.selected = { ...st.selected };
    this.state.act = codes.length
      ? { scenarios: { ...st.selected }, createdMs: st.createdMs, onsetMs: st.onsetMs, status: st.status || 'active', containedMs: null, closedMs: null, pausedTotalMs: 0, disasterMs: null }
      : null;
    this.state.svcPage = 0;
    this.state.notice = codes.length ? `Panel actualizado al estado de referencia de ${roundLabel}.` : 'Panel sin incidente declarado.';
    this.draw();
  }

  elapsed() {
    const a = this.state.act;
    if (!a) return 0;
    const end = a.status === 'contained' ? a.containedMs : a.status === 'closed' ? a.closedMs : this.now();
    return Math.max(0, (end - (a.onsetMs ?? a.createdMs) - (a.pausedTotalMs || 0)) / 1000);
  }

  snapshot() {
    const a = this.state.act;
    if (!a) return null;
    const elapsed = this.elapsed();
    const affected = core.computeAffectedServices(this.data.services, a.scenarios, this.ctx0);
    const pressure = core.computePressure(affected, elapsed, this.data.config);
    const level = core.computeIncidentLevel({ selected: a.scenarios, affected, elapsed, lastLoss: pressure.totalLoss, ctx: this.ctx0 });
    if (pressure.disaster && !a.disasterMs) {
      a.disasterMs = this.now();
      this.onEvent('panel_disaster', { loss_total: Math.round(pressure.totalLoss * 100) / 100, critical_mtpd: pressure.criticosMtpd });
    }
    return {
      elapsed, affected, pressure, level,
      strategies: core.uniqueStrategies(a.scenarios, this.ctx0),
      label: core.pressureLabel({ status: a.status, disaster: !!a.disasterMs, overallTone: pressure.overallTone }),
      rgpd: core.rgpdCountdown(a.onsetMs ?? a.createdMs, this.now()),
      scenarios: Object.keys(a.scenarios).map((c) => ({ ...core.scenarioMaster(c, this.ctx0), category: a.scenarios[c] })),
    };
  }

  setTab(tab) {
    if (tab && tab !== this.state.tab) { this.state.tab = tab; this.draw(); }
  }

  // Redibuja una vez por segundo (reloj, pérdidas, cuentas atrás).
  tick() {
    const s = Math.floor(Date.now() / 1000);
    if (s !== this.lastSecond) { this.lastSecond = s; this.draw(); }
  }

  setHover(id) {
    if (id !== this.hover) { this.hover = id; this.draw(); }
  }

  hitTest(uv) {
    const x = uv.x * W;
    const y = (1 - uv.y) * H;
    for (const r of this.regions) if (!r.disabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    return null;
  }

  /* ─────────────── Acciones ─────────────── */

  handle(id) {
    if (!id) return false;
    const st = this.state;
    const a = st.act;
    const [kind, arg, arg2] = id.split(':');
    st.notice = '';
    if (kind === 'tab') st.tab = arg;
    else if (kind === 'sc') {
      if (st.selected[arg] !== undefined) delete st.selected[arg];
      else st.selected[arg] = Math.min(3, Math.max(1, core.scenarioMaster(arg, this.ctx0).nivel_base || 1));
    } else if (kind === 'cat') st.selected[arg] = parseInt(arg2, 10);
    else if (kind === 'analyze') {
      const codes = Object.keys(st.selected);
      if (!codes.length) st.notice = 'Selecciona al menos un escenario para analizar el impacto.';
      else {
        const now = this.now();
        if (a && a.status !== 'closed') a.scenarios = { ...st.selected };
        else st.act = { scenarios: { ...st.selected }, createdMs: now, onsetMs: null, status: 'active', containedMs: null, closedMs: null, pausedTotalMs: 0, disasterMs: null };
        this.onEvent('panel_analyzed', { scenarios: { ...st.selected }, recalculated: !!(a && a.status !== 'closed') });
        st.tab = 'impact';
      }
    } else if (kind === 'onset' && a) {
      const deltaMin = parseInt(arg, 10);
      const current = a.onsetMs ?? a.createdMs;
      const next = Math.min(this.now(), current + deltaMin * 60000);
      a.onsetMs = next;
      this.onEvent('panel_onset_set', { onset_minutes_before_analysis: Math.round((a.createdMs - next) / 60000) });
    } else if (kind === 'contain' && a && a.status === 'active') {
      Object.assign(a, { status: 'contained', containedMs: this.now() });
      this.onEvent('panel_status', { status: 'contained' });
    } else if (kind === 'resume' && a && a.status === 'contained') {
      a.pausedTotalMs = (a.pausedTotalMs || 0) + (this.now() - a.containedMs);
      Object.assign(a, { status: 'active', containedMs: null });
      this.onEvent('panel_status', { status: 'active' });
    } else if (kind === 'close' && a && a.status !== 'closed') {
      Object.assign(a, { status: 'closed', closedMs: this.now() });
      this.onEvent('panel_status', { status: 'closed', scenarios: { ...a.scenarios } });
      st.notice = 'Seguimiento cerrado e histórico consolidado. La crisis y sus obligaciones siguen su curso.';
    } else if (kind === 'svc') st.svcPage = Math.max(0, st.svcPage + (arg === 'next' ? 1 : -1));
    else if (kind === 'ctx') { st.commsCtx = arg; st.commsItem = null; }
    else if (kind === 'comm') st.commsItem = arg;
    else if (kind === 'sent' && st.commsItem) {
      st.sent[st.commsItem] = this.now();
      this.onEvent('panel_comm_marked', { comm_id: st.commsItem, context: st.commsCtx });
    } else if (kind === 'convene') {
      st.convened = this.now();
      this.onEvent('panel_committee_convened', {});
      st.notice = 'Convocatoria registrada. Duplícala por un canal fuera de banda y confirma la recepción.';
    } else return false;
    this.draw();
    return true;
  }

  /* ─────────────── Dibujo ─────────────── */

  draw() {
    const g = this.g;
    this.regions = [];
    g.clearRect(0, 0, W, H);
    roundRect(g, 3, 3, W - 6, H - 6, 34);
    g.fillStyle = 'rgba(7, 17, 33, 0.95)';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(148,163,184,.35)';
    g.stroke();
    g.textBaseline = 'top';
    const snap = this.snapshot();
    this.drawHeader(snap);
    this.drawTabs();
    const area = { x: 40, y: 200, w: W - 80, h: H - 290 };
    ({ activation: () => this.drawActivation(area, snap), impact: () => this.drawImpact(area, snap), level: () => this.drawLevel(area, snap),
      services: () => this.drawServices(area, snap), committee: () => this.drawCommittee(area, snap), comms: () => this.drawComms(area, snap) })[this.state.tab]();
    if (this.state.notice) {
      this.box(40, H - 78, W - 80, 52, 'rgba(90,132,206,.14)', 'rgba(90,132,206,.4)');
      this.text(this.state.notice, 64, H - 66, 26, THEME.text, 600, W - 130);
    }
    this.texture.needsUpdate = true;
  }

  // Utilidades de dibujo
  font(px, weight = 400) { return `${weight} ${px}px ${FONT}`; }

  text(str, x, y, px, color = THEME.text, weight = 400, maxW = 0, lineH = 0, maxLines = 0) {
    const g = this.g;
    g.font = this.font(px, weight);
    g.fillStyle = color;
    let lines = maxW ? wrap(g, str, maxW) : [String(str)];
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.trimEnd() + '…';
    }
    const lh = lineH || Math.round(px * 1.3);
    lines.forEach((l, i) => g.fillText(l, x, y + i * lh));
    return lines.length * lh;
  }

  box(x, y, w, h, fill, stroke, r = 18) {
    const g = this.g;
    roundRect(g, x, y, w, h, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
  }

  button(id, x, y, w, h, label, { primary = false, active = false, disabled = false, px = 28, color } = {}) {
    const hov = this.hover === id && !disabled;
    const fill = disabled ? '#0f172a' : primary ? (hov ? '#ecff8a' : THEME.lime) : active ? 'rgba(219,242,102,.18)' : hov ? '#334155' : '#1e293b';
    this.box(x, y, w, h, fill, active ? THEME.lime : 'rgba(148,163,184,.35)', 14);
    const g = this.g;
    g.font = this.font(px, 700);
    g.fillStyle = disabled ? '#475569' : primary ? '#0f172a' : color || THEME.text;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    this.regions.push({ id, x, y, w, h, disabled });
  }

  kicker(str, x, y, color = THEME.lime) { return this.text(str.toUpperCase(), x, y, 22, color, 700); }

  drawHeader(snap) {
    const a = this.state.act;
    this.text('PANEL DE CRISIS', 48, 34, 26, THEME.lime, 800);
    this.text('Copiloto de Continuidad', 48, 66, 34, THEME.text, 700);
    const status = !a ? ['SIN INCIDENTE ACTIVO', THEME.muted] : a.status === 'contained' ? ['🟠 SEGUIMIENTO PAUSADO', THEME.amber]
      : a.status === 'closed' ? ['⚪ INCIDENTE CERRADO', THEME.muted] : ['🔴 INCIDENTE EN SEGUIMIENTO', THEME.red];
    let x = 700;
    const chip = (label, color, w) => { this.box(x, 40, w, 64, 'rgba(255,255,255,.05)', 'rgba(148,163,184,.3)', 32); this.text(label, x + 22, 59, 23, color, 700, w - 34, 0, 1); x += w + 16; };
    x = 590;
    chip(status[0], status[1], 480);
    chip('⏱ ' + (snap ? core.fmtHMS(snap.elapsed) : '00:00'), THEME.text, 200);
    chip(core.fmtEur(snap ? snap.pressure.totalLoss : 0), THEME.text, 250);
    this.text(new Date(this.now()).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }), W - 230, 60, 26, THEME.muted, 600);
  }

  drawTabs() {
    const n = TABS.length;
    const w = (W - 80 - (n - 1) * 10) / n;
    TABS.forEach((t, i) => {
      const x = 40 + i * (w + 10);
      const active = this.state.tab === t.id;
      this.button('tab:' + t.id, x, 124, w, 62, `${t.icon}  ${t.label}`, { active, px: 26 });
    });
  }

  empty(area, msg) {
    this.box(area.x, area.y, area.w, 140, 'rgba(255,255,255,.03)', 'rgba(148,163,184,.3)');
    this.text(msg, area.x + 32, area.y + 50, 30, THEME.muted, 500, area.w - 64);
  }

  drawActivation(area, snap) {
    const st = this.state;
    const cat = core.scenarioCatalog(this.ctx0);
    this.kicker('Paso 1 · Declarar situación', area.x, area.y);
    this.text('¿Qué está pasando? Selecciona el escenario o la combinación activa y su categoría.', area.x, area.y + 32, 26, THEME.muted, 500);
    const gx = area.x, gy = area.y + 80, cols = 4, cw = 290, ch = 250, gap = 16;
    cat.forEach((sc, i) => {
      const x = gx + (i % cols) * (cw + gap);
      const y = gy + Math.floor(i / cols) * (ch + gap);
      const sel = st.selected[sc.code] !== undefined;
      const id = 'sc:' + sc.code;
      this.box(x, y, cw, ch, sel ? 'rgba(90,132,206,.2)' : this.hover === id ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)', sel ? '#79c6ff' : 'rgba(148,163,184,.3)');
      this.regions.push({ id, x, y, w: cw, h: sel ? 150 : ch });
      this.box(x + 18, y + 18, 70, 48, 'rgba(90,132,206,.2)', null, 10);
      this.text(sc.code, x + 30, y + 28, 28, THEME.text, 800);
      this.text(sc.icon || '', x + cw - 60, y + 22, 34);
      this.text(sc.short, x + 18, y + 78, 23, THEME.text, 700, cw - 36, 29, sel ? 3 : 4);
      if (sel) {
        [1, 2, 3].forEach((c) => this.button(`cat:${sc.code}:${c}`, x + 18 + (c - 1) * 86, y + ch - 76, 78, 56, 'C' + c, { active: st.selected[sc.code] === c, px: 26 }));
      } else {
        this.text(`${sc.tipo_calculo} · base N${sc.nivel_base}`, x + 18, y + ch - 44, 22, THEME.muted, 500);
      }
    });
    // Categoría elegida (descripción)
    const selCodes = Object.keys(st.selected);
    const descY = gy + 2 * (ch + gap) + 4;
    if (selCodes.length) {
      const d = selCodes.map((c) => { const m = core.scenarioMaster(c, this.ctx0); return `${c} C${st.selected[c]}: ${m['categoria_' + st.selected[c]] || ''}`; }).join('   ·   ');
      this.text(d, gx, descY, 22, THEME.muted, 500, 4 * cw + 3 * gap, 28);
    }
    // Columna derecha
    const rx = gx + 4 * (cw + gap) + 20, rw = area.x + area.w - rx;
    const a = st.act;
    const open = a && a.status !== 'closed';
    this.kicker('Paso 2', rx, area.y);
    this.button('analyze', rx, area.y + 36, rw, 120, open ? 'RECALCULAR IMPACTO' : 'ANALIZAR IMPACTO', { primary: true, disabled: !selCodes.length, px: 34 });
    this.text('Calcula nivel, servicios y estrategias activables', rx, area.y + 170, 22, THEME.muted, 500, rw);
    // Hora real de inicio
    const oy = area.y + 222;
    this.box(rx, oy, rw, 230, 'rgba(255,255,255,.035)', 'rgba(148,163,184,.3)');
    this.kicker('⏱ Hora real de inicio', rx + 20, oy + 18);
    if (a) {
      const onset = a.onsetMs ?? a.createdMs;
      const before = Math.round((a.createdMs - onset) / 60000);
      this.text(hhmm(onset) + (before > 0 ? `  (${before} min antes del análisis)` : '  (= hora del análisis)'), rx + 20, oy + 56, 28, THEME.text, 700, rw - 40);
      const bw = (rw - 40 - 3 * 10) / 4;
      [['-60', '−1 h'], ['-15', '−15 min'], ['-5', '−5 min'], ['5', '+5 min']].forEach(([d, l], i) => this.button('onset:' + d, rx + 20 + i * (bw + 10), oy + 110, bw, 64, l, { px: 24 }));
      this.text('Ajusta el reloj si el incidente empezó antes.', rx + 20, oy + 188, 22, THEME.muted, 500, rw - 40);
    } else this.text('Disponible tras analizar el impacto.', rx + 20, oy + 60, 26, THEME.muted, 500, rw - 40);
    // Estrategias activables
    const sy = oy + 250;
    this.kicker('Estrategias activables', rx, sy);
    const strategies = core.uniqueStrategies(st.selected, this.ctx0);
    strategies.forEach((s, i) => {
      const on = s.activeScenarios.length > 0;
      this.text(`${on ? '●' : '○'} ${s.code} · ${s.title}`, rx, sy + 36 + i * 34, 23, on ? THEME.lime : 'rgba(148,163,184,.55)', on ? 700 : 500, rw, 0, 1);
    });
  }

  drawImpact(area, snap) {
    if (!snap) return this.empty(area, 'Analiza el incidente en la pestaña Activación para ver el impacto.');
    const l = snap.level;
    let y = area.y;
    if (snap.pressure.disaster) {
      this.box(area.x, y, area.w, 70, 'rgba(194,38,46,.18)', 'rgba(248,113,113,.6)');
      this.text(`! Condición de desastre · pérdida acumulada ${core.fmtEur(snap.pressure.totalLoss)} · se desbloquea la ficha del comité`, area.x + 24, y + 20, 27, '#ffd6d8', 700, area.w - 48);
      y += 86;
    }
    const minRpo = snap.affected.reduce((m, s) => (s.rpo_h > 0 && (m === null || s.rpo_h < m) ? s.rpo_h : m), null);
    const kpis = [
      ['Escenarios activos', String(snap.scenarios.length), snap.scenarios.map((s) => `${s.code} C${s.category}`).join(' + ')],
      ['Servicios expuestos', String(snap.affected.length), `${l.criticalCount} con impacto crítico`],
      ['RTO más exigente', core.fmtHoras(l.minRto), 'Ventana más restrictiva'],
      ['RPO más exigente', core.fmtHoras(minRpo), 'Tolerancia a pérdida de datos'],
      ['Pérdida / hora', core.fmtEur(l.totalLossHour), 'Exposición combinada'],
    ];
    const kw = (area.w - 4 * 16) / 5;
    kpis.forEach(([k, v, m], i) => {
      const x = area.x + i * (kw + 16);
      this.box(x, y, kw, 170, 'rgba(255,255,255,.04)', 'rgba(148,163,184,.3)');
      this.text(k.toUpperCase(), x + 20, y + 18, 20, THEME.muted, 700);
      this.text(v, x + 20, y + 54, 46, THEME.text, 800);
      this.text(m, x + 20, y + 122, 20, THEME.muted, 500, kw - 40);
    });
    y += 190;
    // Servicios bajo presión
    const lw = area.w * 0.62;
    this.kicker('Impact Scan · servicios bajo presión', area.x, y);
    snap.affected.slice(0, 8).forEach((s, i) => {
      const ry = y + 40 + i * 58;
      const tone = core.serviceTone(s, snap.elapsed);
      this.g.fillStyle = TONE[tone];
      this.g.beginPath(); this.g.arc(area.x + 16, ry + 18, 11, 0, Math.PI * 2); this.g.fill();
      this.text(`${s.codigo}  ${s.nombre}`, area.x + 42, ry + 2, 25, THEME.text, 600, lw - 330, 0, 1);
      this.text(core.zoneText(s, snap.elapsed), area.x + lw - 280, ry + 4, 23, TONE[tone], 700);
    });
    if (snap.affected.length > 8) this.text(`… y ${snap.affected.length - 8} más en Servicios RTO`, area.x + 42, y + 40 + 8 * 58, 22, THEME.muted);
    // Reloj
    const rx = area.x + lw + 30, rw = area.w - lw - 30;
    this.box(rx, y, rw, area.y + area.h - y, 'rgba(255,255,255,.04)', 'rgba(148,163,184,.3)');
    this.kicker('Reloj de seguimiento', rx + 24, y + 22);
    this.text(core.fmtHMS(snap.elapsed), rx + 24, y + 60, 76, THEME.text, 900);
    this.box(rx + 24, y + 158, rw - 48, 50, 'rgba(255,255,255,.05)', null, 25);
    this.text(snap.label.text, rx + 44, y + 170, 25, TONE[snap.label.cls], 800);
    this.text('Pérdida acumulada estimada', rx + 24, y + 228, 22, THEME.muted, 600);
    this.text(core.fmtEur(snap.pressure.totalLoss), rx + 24, y + 258, 40, THEME.text, 800);
    this.text('Umbral de escalada: ' + core.fmtEur(parseFloat(this.data.config.umbral_perdida_eur || 5000)), rx + 24, y + 310, 22, THEME.muted, 500);
    const a = this.state.act;
    const bw = (rw - 48 - 20) / 3;
    this.button('contain', rx + 24, y + 356, bw, 66, 'Pausar', { disabled: a.status !== 'active', px: 24 });
    this.button('resume', rx + 24 + bw + 10, y + 356, bw, 66, 'Reanudar', { disabled: a.status !== 'contained', px: 24 });
    this.button('close', rx + 24 + 2 * (bw + 10), y + 356, bw, 66, 'Cerrar incidente', { disabled: a.status === 'closed', px: 22 });
  }

  drawLevel(area, snap) {
    if (!snap || !snap.level) return this.empty(area, 'Analiza el incidente para calcular el nivel.');
    const l = snap.level;
    const lw = area.w * 0.58;
    this.box(area.x, area.y, 130, 130, LEVEL_COLOR[l.level], null, 26);
    this.g.textAlign = 'center';
    this.text('N' + l.level, area.x + 65, area.y + 32, 64, '#0f172a', 900);
    this.g.textAlign = 'left';
    this.text(l.title, area.x + 160, area.y + 14, 38, THEME.text, 800, lw - 160);
    this.text(l.note, area.x + 160, area.y + 70, 25, THEME.muted, 500, lw - 160);
    const mets = [['Base escenario', 'N' + l.baseLevel], ['Servicios', String(l.affected)], ['RTO mínimo', core.fmtHoras(l.minRto)], ['Pérdida/hora', core.fmtEur(l.totalLossHour)]];
    const mw = (lw - 30) / 2;
    mets.forEach(([k, v], i) => {
      const x = area.x + (i % 2) * (mw + 30), y = area.y + 160 + Math.floor(i / 2) * 120;
      this.box(x, y, mw, 104, 'rgba(255,255,255,.04)', 'rgba(148,163,184,.3)');
      this.text(k.toUpperCase(), x + 20, y + 16, 20, THEME.muted, 700);
      this.text(v, x + 20, y + 48, 38, THEME.text, 800);
    });
    let y = area.y + 420;
    this.kicker('Motivos de cálculo', area.x, y);
    l.reasons.forEach((r, i) => this.text('• ' + r, area.x, y + 36 + i * 34, 24, THEME.text, 500, lw));
    y += 50 + l.reasons.length * 34;
    if (l.hardTriggers.length) {
      const hh = 60 + l.hardTriggers.length * 34;
      this.box(area.x, y, lw, hh, 'rgba(194,38,46,.12)', 'rgba(248,113,113,.4)');
      this.text('Criterios de escalada automática', area.x + 20, y + 14, 25, THEME.text, 800);
      l.hardTriggers.forEach((t, i) => this.text('• ' + t, area.x + 20, y + 50 + i * 34, 24, '#ffd6d8', 500, lw - 40));
      y += hh + 16;
    }
    this.box(area.x, y, lw, 60, l.committeeRecommended ? 'rgba(234,155,49,.16)' : 'rgba(255,255,255,.04)', null);
    this.text(l.committeeRecommended ? 'Se recomienda activar el comité de continuidad.' : 'No se requiere activación de comité en este momento.', area.x + 20, y + 16, 26, l.committeeRecommended ? '#ffe2bb' : THEME.muted, 700);
    // Desglose de puntos
    const rx = area.x + lw + 40, rw = area.w - lw - 40;
    this.box(rx, area.y, rw, area.h, 'rgba(255,255,255,.035)', 'rgba(148,163,184,.3)');
    this.kicker('¿Cómo se calcula?', rx + 24, area.y + 20);
    l.points.forEach((p, i) => {
      const y2 = area.y + 64 + i * 42;
      this.text(p.label, rx + 24, y2, 23, THEME.text, 500, rw - 140);
      this.text('+' + String(p.value).replace('.', ','), rx + rw - 90, y2, 23, THEME.lime, 700);
    });
    const ty = area.y + 76 + l.points.length * 42;
    this.text(`Puntuación ${String(l.score).replace('.', ',')}  →  N1 < 2,5 ≤ N2 < 4 ≤ N3`, rx + 24, ty, 24, THEME.text, 800, rw - 48);
    this.text('Escalada automática a N3: categoría 3, MTPD superado o pérdida acumulada sobre el umbral.', rx + 24, ty + 44, 21, THEME.muted, 500, rw - 48);
  }

  drawServices(area, snap) {
    if (!snap) return this.empty(area, 'Analiza el incidente para ver la lista priorizada por RTO.');
    const list = snap.affected;
    const pages = Math.max(1, Math.ceil(list.length / SVC_PAGE));
    const page = Math.min(this.state.svcPage, pages - 1);
    this.state.svcPage = page;
    this.kicker(`Servicios priorizados · ${list.length} expuestos`, area.x, area.y);
    list.slice(page * SVC_PAGE, (page + 1) * SVC_PAGE).forEach((s, i) => {
      const y = area.y + 44 + i * 94;
      const tone = core.serviceTone(s, snap.elapsed);
      this.box(area.x, y, area.w, 84, 'rgba(255,255,255,.035)', 'rgba(148,163,184,.25)', 14);
      this.text(`${s.codigo}  ${s.nombre}`, area.x + 20, y + 12, 26, THEME.text, 700, area.w * 0.5, 0, 1);
      this.text(`RTO ${core.fmtHoras(s.rto_h)} · RPO ${core.fmtHoras(s.rpo_h)} · MTPD ${core.fmtHoras(s.mtpd_h)} · ${s.impact.text}`, area.x + 20, y + 48, 21, THEME.muted, 500);
      const bx = area.x + area.w * 0.52, bw = area.w * 0.2;
      this.box(bx, y + 36, bw, 12, 'rgba(255,255,255,.08)', null, 6);
      this.box(bx, y + 36, Math.max(8, bw * core.serviceProgress(s, snap.elapsed) / 100), 12, TONE[tone], null, 6);
      this.text(core.fmtEur(s.perdida_h) + '/h', area.x + area.w * 0.74, y + 14, 22, '#ffd8a0', 700);
      this.text(core.getTimerText(s, snap.elapsed), area.x + area.w * 0.74, y + 46, 22, TONE[tone], 700);
    });
    const py = area.y + 44 + SVC_PAGE * 94 + 4;
    this.button('svc:prev', area.x, py, 200, 60, '◀ Anterior', { disabled: page === 0, px: 24 });
    this.text(`Página ${page + 1} de ${pages}`, area.x + 230, py + 16, 24, THEME.muted, 600);
    this.button('svc:next', area.x + 440, py, 200, 60, 'Siguiente ▶', { disabled: page >= pages - 1, px: 24 });
  }

  drawCommittee(area, snap) {
    const lw = area.w * 0.58;
    const unlocked = !!snap && (!!this.state.act.disasterMs || snap.level.committeeRecommended);
    this.kicker('Modo 3 · Comité', area.x, area.y);
    this.text('Preparar activación del comité', area.x, area.y + 32, 36, THEME.text, 800);
    this.box(area.x, area.y + 90, lw, 56, unlocked ? 'rgba(8,173,102,.16)' : 'rgba(255,255,255,.04)', 'rgba(148,163,184,.3)', 28);
    this.text(unlocked ? (this.state.act.disasterMs ? 'Desbloqueada · Condición de desastre' : 'Desbloqueada · Nivel requiere comité') : 'Bloqueada · Nivel insuficiente para convocar comité',
      area.x + 24, area.y + 104, 25, unlocked ? '#d8ffed' : THEME.muted, 700);
    if (snap) {
      const l = snap.level;
      const lines = [
        `Nivel de gravedad: N${l.level} · ${l.title.split('· ')[1] || ''}`,
        `Tiempo transcurrido: ${core.fmtHMS(snap.elapsed)}`,
        `Pérdida acumulada estimada: ${core.fmtEur(snap.pressure.totalLoss)}`,
        `Escenarios: ${snap.scenarios.map((s) => `${s.code} (categoría ${s.category})`).join(', ')}`,
        `Servicios en ventana de continuidad: ${snap.affected.length} · críticos: ${l.criticalCount}`,
        `RTO más exigente: ${core.fmtHoras(l.minRto)} · MTPD superado: ${l.exceededMtpd}`,
      ];
      this.kicker('Ficha de activación · resumen', area.x, area.y + 176);
      lines.forEach((t, i) => this.text('• ' + t, area.x, area.y + 214 + i * 40, 25, THEME.text, 500, lw));
    }
    const by = area.y + 480;
    this.button('convene', area.x, by, lw, 90, this.state.convened ? `✓ Convocatoria registrada ${hhmm(this.state.convened)}` : '✉  Enviar convocatoria al comité', { primary: !this.state.convened, disabled: !unlocked, px: 30 });
    this.text('Recuerda: duplicar por canal fuera de banda, permitir verificar la legitimidad y confirmar la recepción.', area.x, by + 110, 22, THEME.muted, 500, lw);
    // Mesa de mando
    const rx = area.x + lw + 40, rw = area.w - lw - 40;
    this.box(rx, area.y, rw, area.h, 'rgba(255,255,255,.035)', 'rgba(148,163,184,.3)');
    this.kicker('Mesa de mando · contactos', rx + 24, area.y + 20);
    const cfg = this.data.config;
    const people = [{ name: cfg.lead_name, email: cfg.lead_email }];
    const seen = new Set();
    for (const s of snap ? snap.affected : []) {
      const k = s.responsable.email || s.responsable.name;
      if (!seen.has(k) && people.length < 7) { seen.add(k); people.push(s.responsable); }
    }
    people.forEach((p, i) => {
      const y = area.y + 62 + i * 68;
      this.text(p.name, rx + 24, y, 24, THEME.text, 700, rw - 48);
      this.text(p.email || '', rx + 24, y + 30, 20, THEME.muted, 500, rw - 48);
    });
    const dy = area.y + 62 + 7 * 68 + 10;
    this.kicker('Documentos operativos', rx + 24, dy);
    ['Directorio del equipo de respuesta', 'Plan de gestión de incidentes', 'Estrategia de recuperación'].forEach((d, i) => this.text('📄 ' + d, rx + 24, dy + 38 + i * 36, 23, '#cae4ff', 500, rw - 48));
  }

  drawComms(area, snap) {
    const st = this.state;
    const cw = (area.w * 0.6 - 20) / 3;
    CTX.forEach((c, i) => this.button('ctx:' + c.id, area.x + i * (cw + 10), area.y, cw, 64, c.label, { active: st.commsCtx === c.id, px: 23 }));
    const items = core.getCommsForCtx(st.commsCtx);
    const mandatory = items.filter((i) => i.mandatory).length;
    let y = area.y + 84;
    this.text(`Sí — hay ${items.length} comunicaciones${mandatory ? `, ${mandatory} obligatorias` : ''}.`, area.x, y, 27, THEME.text, 700);
    y += 44;
    const elapsedMin = snap ? snap.elapsed / 60 : null;
    if (snap && items.some((i) => i.plazo_horas === 72)) {
      const r = snap.rgpd;
      this.box(area.x, y, area.w * 0.6, 60, r.expired ? 'rgba(194,38,46,.2)' : 'rgba(234,155,49,.14)', null);
      this.text(r.expired ? '⛔ Plazo RGPD vencido. Documenta el motivo del retraso.' : `⏳ RGPD 72 h: quedan ${r.hours} h ${r.minutes} min para notificar a la AEPD si aplica.`,
        area.x + 20, y + 16, 25, r.expired ? '#ffd6d8' : '#ffe2bb', 700, area.w * 0.6 - 40);
      y += 76;
    } else if (!snap) {
      this.text('Sin incidente activo — los plazos se calculan al declarar.', area.x, y, 23, THEME.muted, 500);
      y += 40;
    }
    const lw = area.w * 0.6;
    items.forEach((it, i) => {
      const iy = y + i * 86;
      const id = 'comm:' + it.id;
      const sel = st.commsItem === it.id;
      const status = core.getCommsStatus(it, elapsedMin);
      this.box(area.x, iy, lw, 76, sel ? 'rgba(90,132,206,.2)' : this.hover === id ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.035)', sel ? '#79c6ff' : 'rgba(148,163,184,.25)', 14);
      this.regions.push({ id, x: area.x, y: iy, w: lw, h: 76 });
      this.g.fillStyle = TONE[it.color] || THEME.green;
      this.g.beginPath(); this.g.arc(area.x + 24, iy + 38, it.mandatory ? 11 : 7, 0, Math.PI * 2); this.g.fill();
      this.text(it.title + (st.sent[it.id] ? '  ✓' : ''), area.x + 50, iy + 10, 24, THEME.text, 700, lw - 260, 0, 1);
      this.text(it.when, area.x + 50, iy + 44, 20, THEME.muted, 500);
      this.text(status.label, area.x + lw - 200, iy + 26, 22, status.key === 'overdue' ? THEME.red : THEME.lime, 700);
    });
    // Ficha
    const rx = area.x + lw + 30, rw = area.w - lw - 30;
    this.box(rx, area.y, rw, area.h, 'rgba(255,255,255,.035)', 'rgba(148,163,184,.3)');
    const it = items.find((i) => i.id === st.commsItem);
    if (!it) { this.text('Selecciona un hito para ver su ficha operativa.', rx + 24, area.y + 30, 25, THEME.muted, 500, rw - 48); return; }
    this.kicker('Ficha operativa', rx + 24, area.y + 22);
    let fy = area.y + 60;
    fy += this.text(it.title, rx + 24, fy, 28, THEME.text, 800, rw - 48) + 14;
    for (const [k, v] of [['Quién debe notificar', it.quien], ['Canal', it.canal], ['Plazo', it.plazo], ['Base normativa', it.base], ['Evidencia a conservar', it.evidencia]]) {
      this.text(k.toUpperCase(), rx + 24, fy, 19, THEME.muted, 700);
      fy += 28 + this.text(v, rx + 24, fy + 26, 23, THEME.text, 500, rw - 48) + 8;
    }
    this.button('sent', rx + 24, area.y + area.h - 90, rw - 48, 68, st.sent[it.id] ? `✓ Notificado ${hhmm(st.sent[it.id])}` : 'Marcar como notificado', { primary: !st.sent[it.id], px: 26 });
  }
}
