// Sincronización en directo entre visores.
//
// Transporte «peer» (por defecto): WebRTC con PeerJS. El primer visor que entra en la sala ocupa el
// identificador de anfitrión y reenvía los mensajes al resto (estrella). Si el anfitrión se cae, los demás
// compiten de nuevo por ese identificador y uno lo sustituye. Internet solo hace falta para el emparejamiento
// (servidor público de PeerJS); los datos van directos entre visores o, si la red lo impide, por TURN.
// Transporte «local»: BroadcastChannel entre pestañas del mismo navegador (pruebas y demostraciones).
//
// Sin conexión no pasa nada: cada visor sigue funcionando por su cuenta como antes.

const HELLO_EVERY = 4000;
const PEER_TIMEOUT = 13000;

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);

export class SyncHub extends EventTarget {
  constructor({ room, role, transport = 'peer' }) {
    super();
    this.room = slug(room);
    this.role = role;
    this.transport = transport;
    this.clientId = newId();
    this.status = 'off';
    this.detail = '';
    this.peers = new Map(); // clientId → { role, step, label, lastSeen }
    this.presence = { step: null, label: '' };
    this._conns = new Map(); // peerjs: peerId → DataConnection
    this._timers = [];
    this._stopped = false;
  }

  /* ─────────────── API pública ─────────────── */

  start() {
    this._stopped = false;
    if (this.transport === 'local') this._startLocal();
    else this._startPeer();
    this._timers.push(setInterval(() => { this._hello(); this._prune(); }, HELLO_EVERY));
    return this;
  }

  stop() {
    this._stopped = true;
    this._timers.forEach(clearInterval);
    this._timers = [];
    clearTimeout(this._retry);
    try { this._bc && this._bc.close(); } catch { /* nada */ }
    try { this._peer && this._peer.destroy(); } catch { /* nada */ }
    this._conns.clear();
    this.peers.clear();
    this._setStatus('off');
  }

  get connected() {
    return this.peers.size > 0;
  }

  // Roles conectados (sin contar este visor).
  roles() {
    return [...this.peers.values()].map((p) => p.role).sort();
  }

  setPresence(presence) {
    this.presence = { ...this.presence, ...presence };
    this._hello();
  }

  send(type, data = {}) {
    const msg = { v: 1, type, from: this.role, cid: this.clientId, at: Date.now(), data };
    this._emitOut(msg);
    return msg;
  }

  /* ─────────────── Mensajes ─────────────── */

  _hello() {
    if (this.status === 'off' || this.status === 'error') return;
    this.send('hello', { step: this.presence.step, label: this.presence.label });
  }

  _prune() {
    const now = Date.now();
    let changed = false;
    for (const [cid, p] of this.peers) if (now - p.lastSeen > PEER_TIMEOUT) { this.peers.delete(cid); changed = true; }
    if (changed) this.dispatchEvent(new CustomEvent('peers'));
  }

  _receive(msg) {
    if (!msg || msg.v !== 1 || msg.cid === this.clientId) return;
    const known = this.peers.get(msg.cid);
    const info = { role: msg.from, lastSeen: Date.now(), step: known?.step ?? null, label: known?.label ?? '' };
    if (msg.type === 'hello') Object.assign(info, { step: msg.data.step, label: msg.data.label });
    else if (msg.type === 'bye') { this.peers.delete(msg.cid); this.dispatchEvent(new CustomEvent('peers')); return; }
    this.peers.set(msg.cid, info);
    if (!known) {
      this.dispatchEvent(new CustomEvent('peers'));
      this.dispatchEvent(new CustomEvent('join', { detail: info }));
      this._hello();
    } else if (msg.type === 'hello' && (known.step !== info.step)) this.dispatchEvent(new CustomEvent('peers'));
    if (msg.type !== 'hello') this.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  _setStatus(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this.dispatchEvent(new CustomEvent('status'));
  }

  /* ─────────────── Transporte local (BroadcastChannel) ─────────────── */

  _startLocal() {
    if (!('BroadcastChannel' in window)) { this._setStatus('error', 'Este navegador no admite sincronización local.'); return; }
    this._bc = new BroadcastChannel('simulacro-sync-' + this.room);
    this._bc.onmessage = (e) => this._receive(e.data);
    this._emitOut = (msg) => this._bc.postMessage(msg);
    this._setStatus('local');
    this._hello();
  }

  /* ─────────────── Transporte PeerJS (WebRTC) ─────────────── */

  _hostId() {
    return `simulacro-mr-${this.room}-anfitrion`;
  }

  _startPeer() {
    const Peer = window.peerjs && window.peerjs.Peer;
    if (!Peer) { this._setStatus('error', 'Falta la librería de sincronización.'); return; }
    this._emitOut = (msg) => {
      for (const c of this._conns.values()) if (c.open) { try { c.send(msg); } catch { /* conexión caída */ } }
    };
    this._tryHost(Peer);
  }

  _scheduleRetry(Peer, ms) {
    if (this._stopped) return;
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._tryHost(Peer), ms);
  }

  // Intenta ser anfitrión; si el identificador está ocupado, se conecta como cliente.
  _tryHost(Peer) {
    if (this._stopped) return;
    try { this._peer && this._peer.destroy(); } catch { /* nada */ }
    this._conns.clear();
    this._setStatus('connecting', 'Buscando la sala…');
    const peer = new Peer(this._hostId(), { debug: 0 });
    this._peer = peer;
    peer.on('open', () => {
      this._setStatus('host', 'Anfitrión de la sala');
      this._hello();
    });
    peer.on('connection', (conn) => this._wire(conn, true));
    peer.on('disconnected', () => { if (!this._stopped && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (this._peer !== peer) return;
      if (err.type === 'unavailable-id') this._joinAsClient(Peer);
      else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        this._setStatus('error', err.type === 'browser-incompatible' ? 'El navegador no admite WebRTC.' : 'Sin conexión con el servidor de emparejamiento. Reintentando…');
        this._scheduleRetry(Peer, 8000);
      }
    });
  }

  _joinAsClient(Peer) {
    try { this._peer && this._peer.destroy(); } catch { /* nada */ }
    const peer = new Peer({ debug: 0 });
    this._peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(this._hostId(), { reliable: true });
      this._wire(conn, false);
      // Si el anfitrión no responde (identificador huérfano), se vuelve a competir por él.
      setTimeout(() => { if (this._peer === peer && !conn.open) this._scheduleRetry(Peer, 500 + Math.random() * 1500); }, 7000);
    });
    peer.on('disconnected', () => { if (!this._stopped && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (this._peer !== peer) return;
      this._setStatus('connecting', 'Reconectando…');
      this._scheduleRetry(Peer, err.type === 'peer-unavailable' ? 300 + Math.random() * 1200 : 4000);
    });
  }

  _wire(conn, asHost) {
    conn.on('open', () => {
      this._conns.set(conn.peer, conn);
      if (!asHost) this._setStatus('client', 'Conectado a la sala');
      this._hello();
    });
    conn.on('data', (msg) => {
      if (asHost) for (const [id, c] of this._conns) if (id !== conn.peer && c.open) { try { c.send(msg); } catch { /* nada */ } }
      this._receive(msg);
    });
    const lost = () => {
      this._conns.delete(conn.peer);
      if (!asHost && !this._stopped) {
        this.peers.clear();
        this.dispatchEvent(new CustomEvent('peers'));
        this._scheduleRetry(window.peerjs.Peer, 300 + Math.random() * 1500); // el anfitrión se fue: nueva elección
      }
    };
    conn.on('close', lost);
    conn.on('error', lost);
  }
}

// Texto corto de estado para la interfaz.
export function syncLabel(hub) {
  if (!hub || hub.status === 'off') return 'Sin sincronizar';
  if (hub.status === 'error') return hub.detail || 'Error de sincronización';
  if (hub.status === 'connecting') return hub.detail || 'Conectando…';
  const roles = hub.roles();
  return roles.length ? `Conectado con ${roles.join(', ')}` : 'En la sala, esperando a los demás visores';
}
