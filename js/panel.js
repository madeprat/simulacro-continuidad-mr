// Panel MR genérico: dibuja contenido en un canvas y lo muestra como un plano 3D.
// Los botones y respuestas son regiones del canvas; el raycast devuelve una uv que
// se traduce a un id de botón.
import * as THREE from '../vendor/three.module.min.js';

const PX_PER_M = 1100;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const THEME = {
  bg: 'rgba(12, 18, 32, 0.92)',
  border: 'rgba(148, 163, 184, 0.35)',
  text: '#f1f5f9',
  muted: '#94a3b8',
  lime: '#dbf266',
  red: '#f87171',
  amber: '#fbbf24',
  blue: '#60a5fa',
  green: '#4ade80',
  btn: '#1e293b',
  btnHover: '#334155',
  btnPrimary: '#dbf266',
  btnPrimaryText: '#0f172a',
};

// Textura de texto nítida a distancia: mipmaps trilineales + anisotropía máxima del visor,
// para que el texto lejano no vibre ni parpadee al mover la cabeza.
export const TEXTURE_OPTIONS = { anisotropy: 8 };
export function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = TEXTURE_OPTIONS.anisotropy;
  return t;
}

export function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i];
      if (ctx.measureText(test).width > maxWidth) { lines.push(line); line = words[i]; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Panel {
  // scale: tamaño tipográfico relativo (1 = texto de cuerpo de ~3 cm de alto).
  constructor(widthM = 1.0, scale = 1) {
    this.widthM = widthM;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.userData.panel = this;
    this.regions = [];
    this.hover = null;
    this.spec = null;
    this.texture = null;
  }

  // spec: { accent, icon, kicker, title, source, body, note, answers:[{id,text,state}], buttons:[{id,label,primary,disabled}] }
  set(spec) {
    this.spec = spec;
    this.hover = null;
    this.draw();
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    this.draw();
  }

  hitTest(uv) {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    for (const r of this.regions) {
      if (!r.disabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    }
    return null;
  }

  draw() {
    const s = this.spec || {};
    const W = Math.round(this.widthM * PX_PER_M);
    const pad = Math.round(W * 0.045);
    const inner = W - pad * 2;
    const k = this.scale;
    const f = (px, weight = 400) => `${weight} ${Math.round(px * k)}px ${FONT}`;
    const ctx = this.ctx;

    // 1) Medir: construir una lista de operaciones de dibujo y la altura total.
    const ops = [];
    let y = pad;
    const regions = [];

    if (s.kicker) {
      ctx.font = f(26, 600);
      ops.push({ t: 'text', font: f(26, 600), color: s.accent || THEME.lime, x: pad, y, text: s.kicker.toUpperCase() });
      y += 40 * k;
    }
    if (s.title) {
      ctx.font = f(46, 700);
      const title = (s.icon ? s.icon + '  ' : '') + s.title;
      for (const line of wrap(ctx, title, inner)) {
        ops.push({ t: 'text', font: f(46, 700), color: THEME.text, x: pad, y, text: line });
        y += 58 * k;
      }
      y += 6 * k;
    }
    if (s.source) {
      ctx.font = f(28, 500);
      for (const line of wrap(ctx, s.source, inner)) {
        ops.push({ t: 'text', font: f(28, 500), color: THEME.muted, x: pad, y, text: line });
        y += 38 * k;
      }
      y += 8 * k;
    }
    if (s.body) {
      ctx.font = f(34);
      for (const line of wrap(ctx, s.body, inner)) {
        ops.push({ t: 'text', font: f(34), color: THEME.text, x: pad, y, text: line });
        y += 46 * k;
      }
      y += 10 * k;
    }
    if (s.note) {
      ctx.font = f(28, 600);
      for (const line of wrap(ctx, s.note, inner)) {
        ops.push({ t: 'text', font: f(28, 600), color: s.noteColor || THEME.amber, x: pad, y, text: line });
        y += 38 * k;
      }
      y += 10 * k;
    }
    if (s.answers && s.answers.length) {
      const badge = 58 * k;
      const textX = pad + badge + 28 * k;
      const textW = inner - badge - 48 * k;
      for (const a of s.answers) {
        ctx.font = f(30);
        const lines = wrap(ctx, a.text, textW);
        const h = Math.max(badge + 24 * k, lines.length * 40 * k + 28 * k);
        regions.push({ id: 'answer:' + a.id, x: pad, y, w: inner, h, disabled: !!a.disabled });
        ops.push({ t: 'answer', x: pad, y, w: inner, h, a, lines, badge, textX, font: f(30), badgeFont: f(32, 700) });
        y += h + 14 * k;
      }
      y += 6 * k;
    }
    if (s.buttons && s.buttons.length && s.vertical) {
      const bh = 80 * k;
      for (const b of s.buttons) {
        regions.push({ id: b.id, x: pad, y, w: inner, h: bh, disabled: !!b.disabled });
        ops.push({ t: 'button', x: pad, y, w: inner, h: bh, b, font: f(30, 600) });
        y += bh + 14 * k;
      }
      y -= 14 * k;
    } else if (s.buttons && s.buttons.length) {
      const bh = 88 * k;
      const gap = 18 * k;
      const bw = (inner - gap * (s.buttons.length - 1)) / s.buttons.length;
      s.buttons.forEach((b, i) => {
        const x = pad + i * (bw + gap);
        regions.push({ id: b.id, x, y, w: bw, h: bh, disabled: !!b.disabled });
        ops.push({ t: 'button', x, y, w: bw, h: bh, b, font: f(32, 700) });
      });
      y += bh;
    }
    const H = Math.ceil(y + pad);

    // 2) Redimensionar canvas / textura / geometría si cambia la altura.
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      if (this.texture) this.texture.dispose();
      this.texture = makeTexture(this.canvas);
      this.material.map = this.texture;
      this.material.needsUpdate = true;
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(this.widthM, this.widthM * H / W);
    }
    this.regions = regions;
    this.heightM = this.widthM * H / W;

    // 3) Dibujar.
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 2, 2, W - 4, H - 4, 28 * k);
    ctx.fillStyle = THEME.bg;
    ctx.fill();
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = s.accent || THEME.border;
    ctx.stroke();
    ctx.textBaseline = 'top';

    for (const op of ops) {
      if (op.t === 'text') {
        ctx.font = op.font; ctx.fillStyle = op.color; ctx.fillText(op.text, op.x, op.y);
      } else if (op.t === 'answer') {
        const { a } = op;
        const hovered = this.hover === 'answer:' + a.id && !a.disabled;
        const selected = a.state === 'selected';
        roundRect(ctx, op.x, op.y, op.w, op.h, 16 * k);
        ctx.fillStyle = selected ? 'rgba(219,242,102,0.18)' : hovered ? THEME.btnHover : THEME.btn;
        ctx.fill();
        ctx.lineWidth = (selected ? 4 : 2) * k;
        ctx.strokeStyle = selected ? THEME.lime : THEME.border;
        ctx.stroke();
        const bx = op.x + 16 * k, by = op.y + (op.h - op.badge) / 2;
        roundRect(ctx, bx, by, op.badge, op.badge, 12 * k);
        ctx.fillStyle = selected ? THEME.lime : '#0f172a';
        ctx.fill();
        ctx.font = op.badgeFont; ctx.fillStyle = selected ? '#0f172a' : THEME.lime;
        ctx.textAlign = 'center';
        ctx.fillText(a.id, bx + op.badge / 2, by + op.badge * 0.2);
        ctx.textAlign = 'left';
        ctx.font = op.font; ctx.fillStyle = a.disabled ? THEME.muted : THEME.text;
        const textH = op.lines.length * 40 * k;
        let ly = op.y + (op.h - textH) / 2;
        for (const line of op.lines) { ctx.fillText(line, op.textX, ly); ly += 40 * k; }
      } else if (op.t === 'button') {
        const { b } = op;
        const hovered = this.hover === b.id && !b.disabled;
        roundRect(ctx, op.x, op.y, op.w, op.h, 18 * k);
        ctx.fillStyle = b.disabled ? '#111827' : b.primary ? (hovered ? '#ecff8a' : THEME.btnPrimary) : hovered ? THEME.btnHover : THEME.btn;
        ctx.fill();
        ctx.lineWidth = 2 * k; ctx.strokeStyle = THEME.border; ctx.stroke();
        ctx.font = op.font;
        ctx.fillStyle = b.disabled ? '#475569' : b.primary ? THEME.btnPrimaryText : THEME.text;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.label, op.x + op.w / 2, op.y + op.h / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      }
    }
    this.texture.needsUpdate = true;
  }
}
