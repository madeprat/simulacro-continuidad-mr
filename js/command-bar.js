// Barra de mando: rol, ronda, reloj del ejercicio, conexión con los otros visores, botones y la línea de
// tiempo de la ronda en curso (qué ha pasado, dónde estamos y qué falta). Sustituye al antiguo HUD.
import * as THREE from '../vendor/three.module.min.js';
import { THEME, makeTexture, roundRect } from './panel.js';

const PX_PER_M = 1200;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const STEP_ICON = { PHONE: '📞', DOCUMENT: '📄', ALERT: '⚠️', MESSAGE: '✉️', MEDIA: '🎞', INFO_CARD: 'ℹ️' };

// Resume los pasos de la ronda en curso para la línea de tiempo.
// steps: los de buildSteps(pack); decisions: registro de la sesión; index: paso actual.
export function timelineFor(steps, index, decisions, packRounds) {
  const current = steps[index];
  const round = current && current.round;
  const rounds = packRounds.map((r) => ({
    number: r.number,
    state: !round ? 'done' : r.number < round.number ? 'done' : r === round ? 'current' : 'todo',
  }));
  const items = [];
  if (round) {
    steps.forEach((s, i) => {
      if (s.round !== round || s.kind === 'round_intro' || s.kind === 'round_end') return;
      const state = i < index ? 'done' : i === index ? 'current' : 'todo';
      if (s.kind === 'event') items.push({ state, icon: STEP_ICON[s.event.type] || '•', label: s.event.type === 'PHONE' ? 'Llamada' : s.event.type === 'ALERT' ? 'Alerta' : s.event.type === 'DOCUMENT' ? 'Documento' : s.event.type === 'MESSAGE' ? 'Mensaje' : 'Info' });
      else if (s.kind === 'panel') items.push({ state, icon: '📺', label: 'Panel' });
      else if (s.kind === 'decision') {
        const rec = decisions[s.decision.id];
        items.push({ state, icon: rec ? rec.answer : '?', letter: true, label: `${s.decision.id} · ${s.decision.role}` });
      }
    });
  }
  return { rounds, items };
}

export class CommandBar {
  constructor(widthM = 1.1) {
    this.widthM = widthM;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(widthM * PX_PER_M);
    this.canvas.height = 330;
    this.heightM = (widthM * this.canvas.height) / this.canvas.width;
    this.g = this.canvas.getContext('2d');
    this.texture = makeTexture(this.canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.widthM, this.heightM), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.userData.panel = this;
    this.regions = [];
    this.hover = null;
    this.state = null;
    this.key = '';
  }

  set(state) {
    const key = JSON.stringify(state);
    if (key === this.key) return; // solo se redibuja si algo ha cambiado
    this.key = key;
    this.state = state;
    this.draw();
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    if (this.state) this.draw();
  }

  hitTest(uv) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    for (const r of this.regions) if (!r.disabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    return null;
  }

  font(px, weight = 400) { return `${weight} ${px}px ${FONT}`; }

  draw() {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const s = this.state;
    const pad = 26;
    this.regions = [];
    g.clearRect(0, 0, W, H);
    roundRect(g, 2, 2, W - 4, H - 4, 26);
    g.fillStyle = THEME.bg; g.fill();
    g.lineWidth = 3; g.strokeStyle = s.accent || THEME.border; g.stroke();
    g.textBaseline = 'top';

    // Fila 1: identidad, reloj y botones.
    g.font = this.font(24, 700); g.fillStyle = THEME.lime;
    g.fillText(s.kicker.toUpperCase(), pad, pad);
    g.font = this.font(52, 700); g.fillStyle = THEME.text;
    g.fillText(s.clock, pad, pad + 34);
    if (s.sync) {
      g.font = this.font(24, 600); g.fillStyle = s.syncOk ? THEME.green : THEME.muted;
      g.fillText(s.sync, pad + 250, pad + 54);
    }
    const bw = 150, bh = 70, gap = 12;
    let bx = W - pad - s.buttons.length * bw - (s.buttons.length - 1) * gap;
    for (const b of s.buttons) {
      const hov = this.hover === b.id;
      roundRect(g, bx, pad + 6, bw, bh, 16);
      g.fillStyle = b.active ? 'rgba(219,242,102,.18)' : hov ? THEME.btnHover : THEME.btn; g.fill();
      g.lineWidth = 2; g.strokeStyle = b.active ? THEME.lime : THEME.border; g.stroke();
      g.font = this.font(26, 700); g.fillStyle = THEME.text; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.label, bx + bw / 2, pad + 6 + bh / 2);
      g.textAlign = 'left'; g.textBaseline = 'top';
      this.regions.push({ id: b.id, x: bx, y: pad + 6, w: bw, h: bh });
      bx += bw + gap;
    }

    // Fila 2: rondas del ejercicio.
    const ry = 128;
    const n = s.rounds.length || 1;
    const segGap = 8;
    const segW = (W - pad * 2 - segGap * (n - 1)) / n;
    s.rounds.forEach((r, i) => {
      const x = pad + i * (segW + segGap);
      roundRect(g, x, ry, segW, 12, 6);
      g.fillStyle = r.state === 'done' ? 'rgba(219,242,102,.55)' : r.state === 'current' ? THEME.lime : '#1e293b';
      g.fill();
      if (r.state === 'current') {
        g.font = this.font(22, 700); g.fillStyle = THEME.lime;
        g.fillText(`R${r.number}`, x, ry + 18);
      }
    });

    // Fila 3: pasos de la ronda en curso.
    const items = s.items;
    if (!items.length) return this.flush();
    const top = 190;
    const lineY = top + 34;
    const slot = Math.min(150, (W - pad * 2) / items.length);
    const x0 = pad + slot / 2;
    g.lineWidth = 3; g.strokeStyle = '#334155';
    g.beginPath(); g.moveTo(x0, lineY); g.lineTo(x0 + slot * (items.length - 1), lineY); g.stroke();
    items.forEach((it, i) => {
      const cx = x0 + i * slot;
      if (i > 0 && it.state !== 'todo') {
        g.strokeStyle = 'rgba(219,242,102,.6)';
        g.beginPath(); g.moveTo(cx - slot, lineY); g.lineTo(cx, lineY); g.stroke();
      }
      const r = it.state === 'current' ? 30 : 25;
      g.beginPath(); g.arc(cx, lineY, r, 0, Math.PI * 2);
      g.fillStyle = it.state === 'current' ? THEME.lime : it.state === 'done' ? '#1f2a14' : '#0f172a';
      g.fill();
      g.lineWidth = it.state === 'current' ? 4 : 2;
      g.strokeStyle = it.state === 'todo' ? '#334155' : THEME.lime;
      g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = it.letter ? this.font(it.state === 'current' ? 30 : 26, 800) : this.font(it.state === 'current' ? 28 : 24);
      g.fillStyle = it.state === 'current' ? '#0f172a' : it.state === 'done' ? THEME.lime : THEME.muted;
      g.fillText(it.icon, cx, lineY + 1);
      g.textBaseline = 'top';
      g.font = this.font(19, it.state === 'current' ? 700 : 500);
      g.fillStyle = it.state === 'current' ? THEME.text : THEME.muted;
      g.fillText(it.label, cx, lineY + 40);
      g.textAlign = 'left';
    });
    this.flush();
  }

  flush() { this.texture.needsUpdate = true; }
}
