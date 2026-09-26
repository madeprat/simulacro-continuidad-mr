// Arranque del Copiloto de Continuidad (versión estática, sin servidor).
import { startCopiloto } from './copiloto.js';
import { createClock } from './clock.js';
import { createBackend } from './backend.js';
import { loadDataset } from './data.js';
import { mountExerciseBar } from './ejercicio.js';

const params = new URLSearchParams(location.search);
// ?vista=lectura → solo la pestaña Impacto (pantalla de sala sin controles).
const readOnly = params.get('vista') === 'lectura';
const ALL = { canImpactView: true, canView: true, canDeclare: true, canOperate: true, canClose: true, canHistory: true, canCommittee: true };

const clock = createClock();
const dataset = await loadDataset();
const backend = createBackend({ dataset, clock });

startCopiloto({ config: dataset.config, permissions: readOnly ? { canImpactView: true } : ALL, labels: {} }, backend, clock);
if (!readOnly) mountExerciseBar({ clock, backend, dataset, open: params.has('ejercicio') });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
}
if (params.has('debug')) window.__copiloto = { clock, backend, dataset };
