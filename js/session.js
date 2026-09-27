// Registro de evidencias de sesión (Session Log v1), checkpoint y exportación.
import { assessmentFor } from './pack.js';

export const ENGINE_VERSION = '0.1.0';
export const SESSION_SCHEMA = 'crisis.session/1.0';

const now = () => new Date().toISOString();
const secondsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 100) / 10;

export function checkpointKey(pack, sessionId, role) {
  return `simulacro:${pack.manifest.exercise_id}:${pack.manifest.version}:${sessionId}:${role}`;
}

export function loadCheckpoint(pack, sessionId, role) {
  try {
    const raw = localStorage.getItem(checkpointKey(pack, sessionId, role));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export class Session {
  constructor(pack, { sessionId, role, participant = null }) {
    this.pack = pack;
    this.data = {
      schema: SESSION_SCHEMA,
      session_id: sessionId,
      exercise: { id: pack.manifest.exercise_id, version: pack.manifest.version, name: pack.manifest.name },
      engine_version: ENGINE_VERSION,
      local_role: role,
      participant_label: participant || null,
      created_at: now(),
      started_at: null,
      completed_at: null,
      step_index: 0,
      events: [],
      decisions: {},
    };
    this.shownAt = {};
  }

  static fromCheckpoint(pack, cp) {
    const s = new Session(pack, { sessionId: cp.session_id, role: cp.local_role, participant: cp.participant_label });
    s.data = cp;
    return s;
  }

  get role() { return this.data.local_role; }
  get stepIndex() { return this.data.step_index; }

  log(type, payload = {}) {
    const ev = { seq: this.data.events.length + 1, at: now(), type, ...payload };
    this.data.events.push(ev);
    this.save();
    return ev;
  }

  start() {
    if (!this.data.started_at) {
      this.data.started_at = now();
      this.log('session_started', {
        engine_version: ENGINE_VERSION,
        exercise_id: this.data.exercise.id,
        exercise_version: this.data.exercise.version,
        local_role: this.role,
      });
    } else {
      this.log('session_resumed', { step_index: this.stepIndex });
    }
  }

  setStep(index) {
    this.data.step_index = index;
    this.save();
  }

  decisionShown(round, decision) {
    const at = now();
    this.shownAt[decision.id] = at;
    this.log('decision_shown', {
      round_id: round.id, decision_id: decision.id, active_role: decision.role,
      local_is_active: decision.role === this.role, options: decision.answers.map((a) => a.id),
    });
  }

  // extra: p. ej. { sync_from: 'R2' } cuando la letra llegó sincronizada desde el visor del rol activo.
  decisionAnswered(round, decision, answer, extra = {}) {
    const answered_at = now();
    const shown_at = this.shownAt[decision.id] || answered_at;
    const source = decision.role === this.role ? 'own' : 'observed';
    const previous = this.data.decisions[decision.id];
    const record = {
      round_id: round.id, decision_id: decision.id, active_role: decision.role, answer, answer_source: source,
      shown_at, answered_at, response_seconds: secondsBetween(shown_at, answered_at), ...extra,
    };
    if (previous && previous.answer !== answer) {
      this.log('session_corrected', { decision_id: decision.id, previous_answer: previous.answer, new_answer: answer });
    }
    this.data.decisions[decision.id] = record;
    this.log('decision_answered', record);
    return record;
  }

  complete() {
    if (!this.data.completed_at) {
      this.data.completed_at = now();
      this.log('session_completed', { duration_seconds: this.durationSeconds(), summary: this.summary() });
    }
  }

  elapsedSeconds() {
    if (!this.data.started_at) return 0;
    const end = this.data.completed_at ? Date.parse(this.data.completed_at) : Date.now();
    return Math.max(0, Math.floor((end - Date.parse(this.data.started_at)) / 1000));
  }

  durationSeconds() { return this.elapsedSeconds(); }

  summary() {
    const decisions = Object.values(this.data.decisions);
    const rounds = new Set(this.data.events.filter((e) => e.type === 'round_completed').map((e) => e.round_id));
    return {
      rounds_total: this.pack.rounds.length,
      rounds_completed: rounds.size,
      decisions_total: this.pack.decisionCount,
      decisions_recorded: decisions.length,
      decisions_own: decisions.filter((d) => d.answer_source === 'own').length,
      decisions_observed: decisions.filter((d) => d.answer_source === 'observed').length,
      panel_actions_confirmed: this.data.events.filter((e) => e.type === 'panel_action_confirmed').length,
      corrections: this.data.events.filter((e) => e.type === 'session_corrected').length,
      duration_seconds: this.durationSeconds(),
    };
  }

  save() {
    try {
      localStorage.setItem(checkpointKey(this.pack, this.data.session_id, this.role), JSON.stringify(this.data));
    } catch {
      /* almacenamiento no disponible: la sesión continúa en memoria */
    }
  }

  fileBase() {
    return `${this.data.exercise.id}_${this.data.session_id}_${this.role}`.replace(/[^\w.-]+/g, '_');
  }

  toJSON() {
    const { step_index, ...rest } = this.data;
    return JSON.stringify({ ...rest, summary: this.summary() }, null, 2);
  }

  toCSV() {
    const cols = ['session_id', 'exercise_id', 'exercise_version', 'round_id', 'decision_id', 'active_role', 'local_role',
      'answer', 'answer_source', 'shown_at', 'answered_at', 'response_seconds', 'reference_rating'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [cols.join(',')];
    for (const round of this.pack.rounds) {
      for (const d of round.decisions || []) {
        const rec = this.data.decisions[d.id];
        const assessment = assessmentFor(this.pack, d);
        let rating = 'no_evaluada';
        if (rec && assessment && assessment.preferred_response) {
          rating = rec.answer === assessment.preferred_response ? 'esperada' : 'desviacion';
        }
        rows.push([
          this.data.session_id, this.data.exercise.id, this.data.exercise.version, round.id, d.id, d.role, this.role,
          rec?.answer ?? '', rec?.answer_source ?? '', rec?.shown_at ?? '', rec?.answered_at ?? '', rec?.response_seconds ?? '',
          rec ? rating : '',
        ].map(esc).join(','));
      }
    }
    return '﻿' + rows.join('\r\n') + '\r\n';
  }
}

export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
