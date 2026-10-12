// Histórico de simulacros en el PC del facilitador (IndexedDB de este navegador; nada sale del equipo).
// Cada registro guarda los JSON originales de los visores, lo editado por el facilitador y un resumen para la lista,
// así cualquier informe se puede reabrir, comparar y exportar como copia de seguridad.

const DB = 'simulacro-debrief';
const STORE = 'informes';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('Este navegador no permite guardar el histórico.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const recordKey = (result) => `${result.exercise?.id}|${result.exercise?.version}|${result.session_id}`;

export const saveRecord = (rec) => tx('readwrite', (s) => s.put({ ...rec, savedAt: new Date().toISOString() }));
export const getRecord = (key) => tx('readonly', (s) => s.get(key));
export const deleteRecord = (key) => tx('readwrite', (s) => s.delete(key));
export async function listRecords() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// Copia de seguridad: un único JSON con todos los simulacros guardados.
export async function exportArchive() {
  return JSON.stringify({ schema: 'crisis.debrief-archive/1.0', exported_at: new Date().toISOString(), records: await listRecords() }, null, 2);
}

export async function importArchive(text) {
  const data = JSON.parse(text);
  if (data.schema !== 'crisis.debrief-archive/1.0' || !Array.isArray(data.records)) throw new Error('El fichero no es un archivo de simulacros.');
  let n = 0;
  for (const r of data.records) if (r && r.key && Array.isArray(r.logs)) { await saveRecord(r); n++; }
  return n;
}
