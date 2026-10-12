// Maqueta esquemática en 3D: plataforma circular con las sedes (por plantas), CPD, salas y proveedores del
// site.json del pack, unidos por sus dependencias. Cada nodo se ilumina según el estado calculado en
// site-model.js: azul operativo, ámbar con servicios afectados, rojo (con pulso) afectado directamente.
// Estética de holograma: rellenos translúcidos y aristas luminosas, sin iluminación ni modelos a medida.
import * as THREE from '../vendor/three.module.min.js';
import { THEME, makeTexture, roundRect } from './panel.js';
import { LIMIT } from './site-model.js';

export const RADIUS = 0.32; // radio de la plataforma (m)
const U = (RADIUS * 0.84) / LIMIT; // metros por unidad del plano del site.json
const FLOOR_H = 0.016;
const FLOOR_GAP = 0.006;
const COLOR = { ok: 0x60a5fa, impacted: 0xfbbf24, hit: 0xf87171, standby: 0x94a3b8 };
const TEXT = { ok: '#93c5fd', impacted: THEME.amber, hit: THEME.red, standby: THEME.muted };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function edgesOf(geo, color, opacity = 0.95) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function labelSprite(width = 0.17) {
  const canvas = document.createElement('canvas');
  canvas.width = 560; canvas.height = 150;
  const texture = makeTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(width, (width * canvas.height) / canvas.width, 1);
  sprite.renderOrder = 12;
  return { sprite, canvas, texture };
}

function drawLabel(l, title, line, color) {
  const g = l.canvas.getContext('2d');
  const W = l.canvas.width, H = l.canvas.height;
  g.clearRect(0, 0, W, H);
  g.font = `700 44px ${FONT}`;
  const tw = g.measureText(title).width;
  g.font = `600 34px ${FONT}`;
  const lw = g.measureText(line).width;
  const w = Math.min(W - 8, Math.max(tw, lw) + 44);
  const x = (W - w) / 2;
  roundRect(g, x, 4, w, H - 8, 22);
  g.fillStyle = 'rgba(11,16,32,0.86)'; g.fill();
  g.lineWidth = 3; g.strokeStyle = color; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.font = `700 44px ${FONT}`; g.fillStyle = THEME.text;
  g.fillText(title, W / 2, 20, w - 30);
  g.font = `600 34px ${FONT}`; g.fillStyle = color;
  g.fillText(line, W / 2, 80, w - 30);
  l.texture.needsUpdate = true;
}

export class SiteView {
  constructor(site) {
    this.site = site;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.nodes = {};
    this.links = [];
    this.key = '';
    this.buildPlatform();
    for (const n of site.nodes) this.buildNode(n);
    for (const l of site.links || []) this.buildLink(l);
    this.title = labelSprite(0.24);
    this.title.sprite.position.set(0, 0.012, RADIUS + 0.035);
    this.group.add(this.title.sprite);
    drawLabel(this.title, site.name, 'Sin escenarios declarados', THEME.lime);
  }

  buildPlatform() {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: 0x0b1224, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    this.group.add(disc);
    const ring = (r, w, color, opacity) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 96),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.001;
      this.group.add(m);
      return m;
    };
    this.rim = ring(RADIUS, 0.006, 0xdbf266, 0.85);
    ring(RADIUS * 0.66, 0.0015, 0x60a5fa, 0.25);
    ring(RADIUS * 0.33, 0.0015, 0x60a5fa, 0.25);
  }

  buildNode(n) {
    const obj = new THREE.Group();
    obj.position.set(n.x * U, 0, n.z * U);
    const fills = [];
    const lines = [];
    const add = (geo, y) => {
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR.ok, transparent: true, opacity: 0.2, depthWrite: false }));
      fill.position.y = y;
      const edge = edgesOf(geo, COLOR.ok);
      edge.position.y = y;
      obj.add(fill, edge);
      fills.push(fill.material); lines.push(edge.material);
    };
    const w = (n.w || 1) * U * 1.6, d = (n.d || 0.8) * U * 1.6;
    let top = 0;
    if (n.type === 'building') {
      const floors = n.floors || 3;
      for (let i = 0; i < floors; i++) add(new THREE.BoxGeometry(w, FLOOR_H, d), FLOOR_H / 2 + i * (FLOOR_H + FLOOR_GAP) + 0.002);
      top = floors * (FLOOR_H + FLOOR_GAP);
    } else if (n.type === 'datacenter') {
      const h = 0.04;
      add(new THREE.BoxGeometry(w, h, d), h / 2 + 0.002);
      for (let i = -1; i <= 1; i++) { // filas de racks
        const rack = new THREE.BoxGeometry(w * 0.18, h * 0.8, d * 0.75);
        const m = edgesOf(rack, COLOR.ok, 0.7);
        m.position.set(i * w * 0.28, h * 0.42, 0);
        obj.add(m); lines.push(m.material);
      }
      top = h;
    } else if (n.type === 'room') {
      add(new THREE.BoxGeometry(w, 0.014, d), 0.009);
      const screen = new THREE.BoxGeometry(w * 0.7, 0.03, 0.002); // videowall de la sala
      const m = edgesOf(screen, COLOR.ok, 0.8);
      m.position.set(0, 0.032, -d / 2 + 0.004);
      obj.add(m); lines.push(m.material);
      top = 0.048;
    } else { // provider: nodo flotante unido al suelo
      const ico = new THREE.IcosahedronGeometry(0.022, 0);
      add(ico, 0.07);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, 0), new THREE.Vector3(0, 0.048, 0)]),
        new THREE.LineBasicMaterial({ color: COLOR.ok, transparent: true, opacity: 0.6 }));
      obj.add(stem); lines.push(stem.material);
      top = 0.095;
    }
    if (n.role === 'backup') { // respaldo: base discontinua para distinguirlo
      const base = new THREE.Mesh(new THREE.RingGeometry(Math.max(w, d) * 0.62, Math.max(w, d) * 0.66, 6),
        new THREE.MeshBasicMaterial({ color: COLOR.standby, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.002;
      obj.add(base);
    }
    const label = labelSprite();
    label.sprite.position.set(0, top + 0.04, 0);
    obj.add(label.sprite);
    this.group.add(obj);
    this.nodes[n.id] = { def: n, obj, fills, lines, label, status: 'ok' };
  }

  buildLink(l) {
    const a = this.nodes[l.from], b = this.nodes[l.to];
    if (!a || !b) return;
    const pa = a.obj.position.clone().setY(0.004), pb = b.obj.position.clone().setY(0.004);
    const mid = pa.clone().add(pb).multiplyScalar(0.5).setY(0.03); // arco ligero
    const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)),
      new THREE.LineBasicMaterial({ color: COLOR.ok, transparent: true, opacity: 0.55 }));
    this.group.add(line);
    this.links.push({ def: l, mat: line.material, status: 'ok' });
  }

  // state: resultado de siteStatus(). Solo se repinta si algo ha cambiado.
  update(state) {
    const key = JSON.stringify(state);
    if (key === this.key) return;
    this.key = key;
    for (const s of state.nodes) {
      const node = this.nodes[s.id];
      if (!node) continue;
      node.status = s.status;
      const c = COLOR[s.status];
      for (const m of node.fills) m.color.setHex(c);
      for (const m of node.lines) m.color.setHex(c);
      drawLabel(node.label, node.def.label, s.line, TEXT[s.status]);
    }
    state.links.forEach((s, i) => {
      if (!this.links[i]) return;
      this.links[i].status = s.status;
      this.links[i].mat.color.setHex(COLOR[s.status]);
    });
    const { hit, impacted } = state.summary;
    const line = hit || impacted
      ? [hit ? `${hit} afectado${hit > 1 ? 's' : ''} directamente` : '', impacted ? `${impacted} con servicios afectados` : ''].filter(Boolean).join(' · ')
      : 'Sin impacto declarado';
    drawLabel(this.title, this.site.name, line, hit ? THEME.red : impacted ? THEME.amber : THEME.lime);
    this.rim.material.color.setHex(hit ? COLOR.hit : impacted ? COLOR.impacted : 0xdbf266);
  }

  // Pulso de lo afectado (se llama en cada fotograma).
  tick(time) {
    if (!this.group.visible) return;
    const p = 0.5 + 0.5 * Math.sin(time * 0.005);
    for (const node of Object.values(this.nodes)) {
      const base = node.status === 'hit' ? 0.22 + 0.3 * p : node.status === 'impacted' ? 0.26 : 0.16;
      for (const m of node.fills) m.opacity = base;
    }
    for (const l of this.links) l.mat.opacity = l.status === 'hit' ? 0.35 + 0.5 * p : 0.5;
  }
}
