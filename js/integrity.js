// Integridad del registro de sesión: cada evento lleva el hash SHA-256 del anterior encadenado con el suyo,
// así que cambiar, quitar o reordenar un evento rompe la cadena a partir de ese punto. El último hash
// («huella del registro») se muestra en las gafas al exportar: anotarlo o fotografiarlo permite comprobar
// después, en el debrief, que el fichero recibido es el que salió del visor.
//
// SHA-256 síncrono (el registro se escribe evento a evento, sin esperas) y sin dependencias: funciona igual
// en el navegador del visor, en el del facilitador y en Node (pruebas).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text) {
  const msg = new TextEncoder().encode(String(text));
  const bitLen = msg.length * 8;
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(total - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// Hash de un evento encadenado al anterior. El evento se serializa sin su propio campo «hash».
export function eventHash(prevHash, event) {
  const { hash, ...body } = event;
  return sha256Hex((prevHash || '') + '\n' + JSON.stringify(body));
}

// Forma corta y legible de la huella para anotarla: «a3f9 12c8 7b40».
export function shortPrint(hash) {
  return hash ? hash.slice(0, 12).replace(/(.{4})(?!$)/g, '$1 ') : '—';
}

// Comprueba la cadena de un registro de sesión y que las decisiones cuadran con sus eventos.
// Devuelve { status: 'integro' | 'alterado' | 'sin_cadena', head, brokenAt, detail }.
export function verifyLog(data) {
  const events = (data && data.events) || [];
  if (!events.some((e) => e.hash)) return { status: 'sin_cadena', head: null, brokenAt: null, detail: 'Registro sin cadena de integridad (versión anterior del motor).' };
  let prev = '';
  for (const e of events) {
    if (!e.hash || eventHash(prev, e) !== e.hash) {
      return { status: 'alterado', head: null, brokenAt: e.seq ?? null, detail: `La cadena se rompe en el evento ${e.seq ?? '?'} (${e.type}).` };
    }
    prev = e.hash;
  }
  // Cada decisión registrada debe coincidir con el último evento «decision_answered» de esa decisión.
  const last = {};
  for (const e of events) if (e.type === 'decision_answered') last[e.decision_id] = e;
  for (const [id, rec] of Object.entries(data.decisions || {})) {
    const ev = last[id];
    if (!ev || ev.answer !== rec.answer || ev.answer_source !== rec.answer_source) {
      return { status: 'alterado', head: prev, brokenAt: null, detail: `La decisión ${id} no coincide con su evento registrado.` };
    }
  }
  if (data.integrity && data.integrity.head && data.integrity.head !== prev) {
    return { status: 'alterado', head: prev, brokenAt: null, detail: 'La huella declarada no coincide con la cadena de eventos.' };
  }
  return { status: 'integro', head: prev, brokenAt: null, detail: `${events.length} eventos encadenados.` };
}
