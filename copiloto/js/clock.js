// Reloj del copiloto: hora real o simulada (para ejercicios que comprimen días en minutos).
// El estado se guarda en el navegador para que una recarga no pierda la hora del ejercicio.

const KEY = 'copiloto:reloj';

export function createClock() {
  let st = { mode: 'real', anchorSim: 0, anchorReal: 0, speed: 1, paused: false };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* sin almacenamiento */ }
  const listeners = new Set();

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* sin almacenamiento */ }
    listeners.forEach((fn) => fn());
  };
  const now = () => {
    if (st.mode !== 'sim') return Date.now();
    return st.paused ? st.anchorSim : st.anchorSim + (Date.now() - st.anchorReal) * st.speed;
  };
  const rebase = (simMs) => { st.anchorSim = simMs; st.anchorReal = Date.now(); };

  return {
    now,
    get mode() { return st.mode; },
    get speed() { return st.speed; },
    get paused() { return st.paused; },
    set(simMs) { st.mode = 'sim'; rebase(simMs); save(); },
    advance(ms) { const t = now(); st.mode = 'sim'; rebase(t + ms); save(); },
    setSpeed(speed) { const t = now(); st.mode = 'sim'; st.speed = speed; rebase(t); save(); },
    pause() { const t = now(); st.mode = 'sim'; st.paused = true; rebase(t); save(); },
    resume() { const t = now(); st.paused = false; rebase(t); save(); },
    real() { st = { mode: 'real', anchorSim: 0, anchorReal: 0, speed: 1, paused: false }; save(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
