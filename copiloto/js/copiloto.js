// Copiloto de Continuidad · interfaz (portada del panel original, sin dependencias de servidor).
// Los cálculos viven en core.js; los datos llegan del catálogo local y el estado del incidente del backend local.
import * as core from './core.js';

export function startCopiloto(data, backend, clock) {

  var root = document.getElementById('copiloto');
  if (!root) {
    return;
  }

  var config = data.config || {};
  var permissions = data.permissions || {};
  // impactOnly = usuario sin permisos de operación; solo puede ver la pestaña Impacto
  var impactOnly = !!(permissions.canImpactView && !permissions.canView);
  var UMBRAL_PERDIDA_EUR = parseFloat(config.umbral_perdida_eur || 5000);
  var UMBRAL_CRITICOS_MTPD = parseInt(config.umbral_criticos_mtpd || 1, 10);
  var UMBRAL_PROB_DESASTRE = parseInt(config.umbral_prob_pct || 75, 10);

  var state = {
    selected: {},
    services: [],
    scenarioRows: [],
    estrategias: {},
    affectedServices: [],
    history: [],
    activation: null,
    activationTs: null,
    onsetTs: null,
    pausedElapsed: null,
    pausedTotalSeconds: 0,
    timerInterval: null,
    activeServiceId: null,
    desastreDeclarado: false,
    activeView: 'activation',
    lastLoss: 0,
    disasterSynced: false,
    levelSummary: null,
    contextError: '',
    actionLock: false
  };

  var el = {
    chip: document.getElementById('cp-last-activation-chip'),
    scanStatus: document.getElementById('cp-scan-status'),
    analyzeBtn: document.getElementById('cp-analyze-btn'),
    incidentStatusChip: document.getElementById('cp-incident-status-chip'),
    viewNotice: document.getElementById('cp-view-notice'),
    activationNotice: document.getElementById('cp-activation-notice'),
    activationStrategies: document.getElementById('cp-activation-strategies'),
    roomStrip: document.getElementById('cp-room-strip'),
    roomStripStatus: document.getElementById('cp-room-strip-status'),
    roomStripClock: document.getElementById('cp-room-strip-clock'),
    roomStripLoss: document.getElementById('cp-room-strip-loss'),
    roomStripMeta: document.getElementById('cp-room-strip-meta'),
    tabs: root.querySelectorAll('.cc-tab'),
    views: root.querySelectorAll('.cc-view'),
    scenariosGrid: document.getElementById('cp-scenarios-grid'),
    patternPreview: document.getElementById('cp-pattern-preview'),
    activateBtn: document.getElementById('cp-activate-btn'),
    impactoKpis: document.getElementById('cp-impact-kpis'),
    impactHeadline: document.getElementById('cp-impact-headline'),
    impactSubline: document.getElementById('cp-impact-subline'),
    desastreAlert: document.getElementById('cp-desastre-alert'),
    constellation: document.getElementById('cp-impact-constellation'),
    drawer: document.getElementById('cp-impact-drawer'),
    svcOverlay: document.getElementById('cp-svc-overlay'),
    svcBackdrop: document.getElementById('cp-svc-backdrop'),
    svcClose: document.getElementById('cp-svc-close'),
    serviceRail: document.getElementById('cp-services-priority'),
    strategies: document.getElementById('cp-impact-strategies'),
    levelWrap: document.getElementById('cp-level-wrap'),
    levelStrategies: document.getElementById('cp-level-strategies'),
    liveClock: document.getElementById('cp-live-clock'),
    liveClockTone: document.getElementById('cp-live-clock-tone'),
    perdidaTotal: document.getElementById('cp-perdida-total'),
    thresholdLossLabel: document.getElementById('cp-threshold-loss-label'),
    containBtn: document.getElementById('cp-contain-btn'),
    resumeBtn: document.getElementById('cp-resume-btn'),
    closeBtn: document.getElementById('cp-close-btn'),
    fichaBtn: document.getElementById('cp-ficha-btn'),
    fichaLockStatus: document.getElementById('cp-ficha-lock-status'),
    fichaContainer: document.getElementById('cp-ficha-container'),
    commandCenter: document.getElementById('cp-command-center'),
    historyWrap: document.getElementById('cp-history-wrap'),
    historyExportBtn: document.getElementById('cp-history-export-btn'),
    onsetBox: document.getElementById('cp-onset-box'),
    onsetInput: document.getElementById('cp-onset-input'),
    onsetApplyBtn: document.getElementById('cp-onset-apply-btn'),
    onsetStatus: document.getElementById('cp-onset-status'),
    commsTimeline: document.getElementById('cp-comms-timeline'),
    commsTimelineWrap: document.getElementById('cp-comms-timeline-wrap'),
    commsUrgencyAlert: document.getElementById('cp-comms-urgency-alert'),
    commsElapsedNote: document.getElementById('cp-comms-elapsed-note'),
    commsCtxGroup: document.getElementById('cp-comms-ctx-group'),
    commsAnswer1: document.getElementById('cp-comms-answer1'),
    commsEmpty: document.getElementById('cp-comms-empty'),
    commsFichaWrap: document.getElementById('cp-comms-ficha-wrap'),
    commsFichaToggle: document.getElementById('cp-comms-ficha-toggle'),
    commsFicha: document.getElementById('cp-comms-ficha')
  };

  var parseNum = core.parseNum, fmtHoras = core.fmtHoras, fmtEur = core.fmtEur, fmtDate = core.fmtDate,
    fmtHMS = core.fmtHMS, pad = core.pad, parseResp = core.parseResp, probPct = core.probPct,
    toneClassName = core.toneClassName, impactTone = core.impactTone, serviceTone = core.serviceTone,
    zoneText = core.zoneText, getTimerText = core.getTimerText, serviceProgress = core.serviceProgress,
    normalizeScenarioType = core.normalizeScenarioType, normalizeScenarioCode = core.normalizeScenarioCode,
    cleanScenarioName = core.cleanScenarioName, getCommsForCtx = core.getCommsForCtx, getCommsStatus = core.getCommsStatus;

  function coreCtx() {
    return { scenarioRows: state.scenarioRows, estrategias: state.estrategias, config: config };
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
















  function getElapsed() {
    if (!state.activationTs) {
      return 0;
    }
    if (state.pausedElapsed !== null && state.pausedElapsed !== undefined) {
      return state.pausedElapsed;
    }
    // Use onsetTs (real incident start) if set — onset can predate activation
    var baseTs = state.onsetTs || state.activationTs;
    return Math.max(0, ((clock.now() - baseTs.getTime()) / 1000) - (state.pausedTotalSeconds || 0));
  }

  function openSvcOverlay() {
    if (!el.svcOverlay) { return; }
    el.svcOverlay.hidden = false;
    // force reflow so transition fires
    void el.svcOverlay.offsetWidth;
    el.svcOverlay.classList.add('is-open');
  }

  function closeSvcOverlay() {
    if (!el.svcOverlay) { return; }
    el.svcOverlay.classList.remove('is-open');
    // wait for transition then hide
    var ov = el.svcOverlay;
    var onEnd = function() {
      ov.hidden = true;
      ov.removeEventListener('transitionend', onEnd);
    };
    ov.addEventListener('transitionend', onEnd);
  }

  function ajax(action, payload, cb) {
    backend.call(action, payload || {})
      .then(cb)
      .catch(function (err) {
        cb({ success: false, data: { mensaje: err.message } });
      });
  }






  function getAssetUrl() {
    return '';
  }

  function openAssetInEmas() {}

  function getCommitteeRecipients() {
    var recipients = [];
    var seen = {};
    if (config.lead_email && !seen[config.lead_email]) {
      seen[config.lead_email] = true;
      recipients.push(config.lead_email);
    }
    for (var i = 0; i < state.affectedServices.length; i++) {
      var email = state.affectedServices[i] && state.affectedServices[i].responsable ? state.affectedServices[i].responsable.email : '';
      if (email && !seen[email]) {
        seen[email] = true;
        recipients.push(email);
      }
    }
    return recipients;
  }

  function setInlineNotice(message, tone) {
    if (!el.activationNotice) { return; }
    if (!message) {
      el.activationNotice.hidden = true;
      el.activationNotice.className = 'cc-inline-notice';
      el.activationNotice.innerHTML = '';
      return;
    }
    el.activationNotice.hidden = false;
    el.activationNotice.className = 'cc-inline-notice is-' + (tone || 'info');
    el.activationNotice.innerHTML = esc(message);
  }

  function setViewNotice(message, tone) {
    if (!el.viewNotice) { return; }
    if (!message) {
      el.viewNotice.hidden = true;
      el.viewNotice.className = 'cc-view-notice';
      el.viewNotice.innerHTML = '';
      return;
    }
    el.viewNotice.hidden = false;
    el.viewNotice.className = 'cc-view-notice is-' + (tone || 'info');
    el.viewNotice.innerHTML = esc(message);
  }

  function setStatusText(message) {
    if (el.scanStatus) {
      el.scanStatus.textContent = message || '';
    }
  }

  function getActivateCtaCopy() {
    var hasOpenActivation = !!state.activation && (state.activation.status || 'active') !== 'closed';
    return hasOpenActivation
      ? {
          labelHtml: 'Recalcular<br>impacto',
          plain: 'Recalcular impacto',
          sub: 'Actualiza servicios, nivel y estrategias activables'
        }
      : {
          labelHtml: 'Analizar<br>impacto',
          plain: 'Analizar impacto',
          sub: 'Calcula nivel y estrategias activables'
        };
  }

  function updateActivateCtaContent(customLabel) {
    if (!el.activateBtn) { return; }
    var btnText = el.activateBtn.querySelector('.cp-btn-text');
    var btnSub = el.activateBtn.querySelector('.cc-scan-core-sub');
    var copy = getActivateCtaCopy();
    if (customLabel) {
      if (btnText) {
        btnText.textContent = customLabel;
      } else {
        el.activateBtn.textContent = customLabel;
      }
      return;
    }
    if (btnText) {
      btnText.innerHTML = copy.labelHtml;
    } else {
      el.activateBtn.textContent = copy.plain;
    }
    if (btnSub) {
      btnSub.textContent = copy.sub;
    }
  }

  function setActionLock(locked, label) {
    state.actionLock = !!locked;
    if (label) {
      updateActivateCtaContent(label);
    } else if (!locked) {
      updateActivateCtaContent();
    }
    updateActionButtons();
  }

  function getScenarioRowsMap() {
    var map = {};
    for (var i = 0; i < state.scenarioRows.length; i++) {
      var row = state.scenarioRows[i] || {};
      var code = normalizeScenarioCode(row.codigo);
      if (code) {
        row.codigo = code;
        map[code] = row;
      }
    }
    return map;
  }



  function getScenarioMaster(code) {
    return core.scenarioMaster(code, coreCtx());
  }

  function getScenarioCatalog() {
    return core.scenarioCatalog(coreCtx());
  }

  function getUniqueStrategies() {
    return core.uniqueStrategies(state.selected, coreCtx());
  }

  function getSelectedScenarioData() {
    var keys = Object.keys(state.selected);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      out.push(getScenarioMaster(keys[i]));
    }
    return out;
  }

  function getEmasStrategyData(code, scenarioCode) {
    var emasStrategies = state.estrategias && state.estrategias[scenarioCode];
    if (emasStrategies) {
      for (var k = 0; k < emasStrategies.length; k++) {
        if (emasStrategies[k].codigo === code) {
          var nombre = emasStrategies[k].nombre || code;
          return {
            title: nombre.replace(/^[A-Z0-9]+-/, '').trim() || nombre,
            idactivo: emasStrategies[k].id || ''
          };
        }
      }
    }
    return null;
  }


  function setTabAvailability(enabled) {
    for (var i = 0; i < el.tabs.length; i++) {
      var tab = el.tabs[i];
      var name = tab.getAttribute('data-tab');
      if (impactOnly) {
        // Impact-only users: only the impact tab is ever enabled
        tab.disabled = (name !== 'impact');
        tab.hidden   = (name !== 'impact');
      } else if (name === 'impact' || name === 'level' || name === 'services' || name === 'committee') {
        tab.disabled = !enabled;
      }
    }
  }

  // Applied once at init for impact-only users: hide every UI element that
  // is not part of the impact view, show a read-only banner, and force the
  // impact tab as the active view.
  function applyImpactOnlyMode() {
    if (!impactOnly) { return; }

    // Hide room-strip controls that require operator role
    var opControls = ['cp-contain-btn', 'cp-resume-btn', 'cp-close-btn', 'cp-ficha-btn',
                      'cp-activate-btn', 'cp-scan-status', 'cp-onset-box'];
    for (var i = 0; i < opControls.length; i++) {
      var el2 = document.getElementById(opControls[i]);
      if (el2) { el2.hidden = true; }
    }

    // Show read-only badge in room strip meta
    if (el.roomStripMeta) {
      var badge = document.createElement('span');
      badge.className = 'cc-readonly-badge';
      badge.textContent = 'Vista de solo lectura';
      el.roomStripMeta.appendChild(badge);
    }

    // Switch straight to impact tab (even before data loads)
    switchTab('impact');
  }

  function switchTab(name) {
    state.activeView = name;
    for (var i = 0; i < el.tabs.length; i++) {
      var tab = el.tabs[i];
      var isActiveTab = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('is-active', isActiveTab);
      tab.setAttribute('aria-selected', isActiveTab ? 'true' : 'false');
      tab.setAttribute('role', 'tab');
    }
    for (var j = 0; j < el.views.length; j++) {
      var view = el.views[j];
      var isActiveView = view.getAttribute('data-view') === name;
      view.classList.toggle('is-active', isActiveView);
      view.setAttribute('role', 'tabpanel');
    }
    if (name !== 'impact') {
      closeSvcOverlay();
    }
    if (name !== 'activation') {
      setInlineNotice('', 'info');
    }
  }

  function updateChip() {
    if (!el.chip) { return; }
    if (!state.activation) {
      el.chip.textContent = 'Sin activaciones recientes';
      return;
    }
    var scenarios = state.activation.scenarios || [];
    var ts = state.activation.created_at_gmt ? fmtDate(state.activation.created_at_gmt) : '—';
    var login = state.activation.created_by_user_login ? ' · ' + state.activation.created_by_user_login : '';
    el.chip.textContent = 'Análisis iniciado ' + ts + ' · ' + scenarios.join(' + ') + login;
  }

  function updateIncidentStatusChip() {
    if (!el.incidentStatusChip) { return; }
    if (!state.activation) {
      el.incidentStatusChip.textContent = 'Sin incidente activo';
      updateRoomStrip();
      return;
    }
    var status = state.activation.status || 'active';
    var label = status === 'contained' ? 'Seguimiento pausado' : status === 'closed' ? 'Incidente cerrado' : 'Incidente en seguimiento';
    el.incidentStatusChip.textContent = label;
    updateRoomStrip();
  }

  function updateRoomStrip() {
    if (!el.roomStrip) { return; }
    if (!state.activation) {
      el.roomStrip.hidden = true;
      return;
    }
    el.roomStrip.hidden = false;
    var status = state.activation.status || 'active';
    var statusLabel = status === 'contained' ? '🟠 SEGUIMIENTO PAUSADO' : status === 'closed' ? '⚪ INCIDENTE CERRADO' : '🔴 INCIDENTE EN SEGUIMIENTO';
    var actor = state.activation.created_by_user_login || state.activation.user_login || 'usuario autorizado';
    if (el.roomStripStatus) { el.roomStripStatus.textContent = statusLabel; }
    if (el.roomStripClock) { el.roomStripClock.textContent = fmtHMS(getElapsed()); }
    if (el.roomStripLoss) { el.roomStripLoss.textContent = fmtEur(state.lastLoss || 0); }
    if (el.roomStripMeta) { el.roomStripMeta.textContent = 'Declarado por ' + actor + ' · Incidente compartido entre usuarios autorizados'; }
  }

  function renderScenarios() {
    var scenarios = getScenarioCatalog();
    var html = '';
    for (var i = 0; i < scenarios.length; i++) {
      var sc = scenarios[i] || {};
      var isSelected = state.selected[sc.code] !== undefined;
      var catVal = isSelected ? (state.selected[sc.code] || 1) : 1;
      var cats = [sc.categoria_1 || 'Gravedad baja', sc.categoria_2 || 'Gravedad media', sc.categoria_3 || 'Gravedad alta'];
      var sliderHtml = isSelected
        ? '<div class="cp-cat-slider-wrap" onclick="event.stopPropagation()">' +
            '<div class="cp-cat-slider-labels"><span class="' + (catVal===1?'is-cat-active':'') + '">C1</span><span class="' + (catVal===2?'is-cat-active':'') + '">C2</span><span class="' + (catVal===3?'is-cat-active':'') + '">C3</span></div>' +
            '<input type="range" class="cp-cat-slider" min="1" max="3" step="1" value="' + catVal + '" data-code="' + esc(sc.code) + '">' +
            '<div class="cp-cat-desc">' + esc(cats[catVal - 1]) + '</div>' +
          '</div>'
        : '';
      html += '<button type="button" class="cc-scenario-card' + (isSelected ? ' is-active' : '') + '" data-code="' + esc(sc.code) + '">' +
        '<span class="cc-scenario-badge cc-asset-link' + (sc.idactivo ? ' is-linked' : '') + '" data-asset-id="' + esc(sc.idactivo || '') + '">' + esc(sc.code) + '</span>' +
        '<span class="cc-scenario-title">' + esc(sc.short || sc.title || sc.code) + '</span>' +
        '<span class="cc-scenario-desc">' + esc(sc.title || '') + '</span>' +
        '<span class="cc-scenario-footer"><span>' + esc(sc.tipo_calculo || 'general') + ' · Nivel base ' + esc(String(sc.nivel_base || 1)) + '</span><span>Umbral ' + esc(String(sc.umbral_prob_servicio || UMBRAL_PROB_DESASTRE)) + '%</span></span>' +
        sliderHtml +
      '</button>';
    }
    el.scenariosGrid.innerHTML = html || '<div class="cp-empty">No hay escenarios activos en el catálogo. Se usarán los escenarios de configuración si están disponibles.</div>';
    var cards = el.scenariosGrid.querySelectorAll('.cc-scenario-card');
    for (var c = 0; c < cards.length; c++) {
      cards[c].addEventListener('click', function (e) {
        if (!permissions.canDeclare || state.actionLock) { return; }
        if (e.target.classList.contains('cp-cat-slider') || e.target.closest('.cp-cat-slider-wrap')) { return; }
        var code = normalizeScenarioCode(this.getAttribute('data-code'));
        if (state.selected[code] !== undefined) {
          delete state.selected[code];
        } else {
          var scMaster = getScenarioMaster(code);
          state.selected[code] = Math.min(3, Math.max(1, scMaster.nivel_base || 1));
        }
        renderScenarios();
        updatePattern();
      });
    }
    // Slider change handlers
    var sliders = el.scenariosGrid.querySelectorAll('.cp-cat-slider');
    for (var s = 0; s < sliders.length; s++) {
      sliders[s].addEventListener('input', function () {
        var code = normalizeScenarioCode(this.getAttribute('data-code'));
        state.selected[code] = parseInt(this.value, 10);
        renderScenarios();
        updatePattern();
      });
    }
  }

  function updatePattern() {
    var selectedData = getSelectedScenarioData();
    if (!selectedData.length) {
      el.patternPreview.innerHTML = permissions.canDeclare
      ? '<span class="cp-pattern-hint">← Selecciona uno o más escenarios para calcular impacto, nivel y recomendaciones</span>'
      : '<span class="cp-pattern-hint">Tu usuario puede consultar el panel, pero no declarar incidentes.</span>';
      if (el.activateBtn) { el.activateBtn.disabled = true; }
      renderStrategies();
      return;
    }
    var labels = [];
    var patterns = [];
    for (var i = 0; i < selectedData.length; i++) {
      labels.push(selectedData[i].code);
      patterns.push(selectedData[i].short || selectedData[i].title || selectedData[i].code);
    }
    var strategies = getUniqueStrategies();
    var strategyNames = [];
    for (var j = 0; j < strategies.length; j++) {
      strategyNames.push(strategies[j].title);
    }
    el.patternPreview.innerHTML = '<strong>' + esc(labels.join(' + ')) + '</strong> · ' + esc(patterns.join(' / ')) + (strategyNames.length ? ' · Estrategias sugeridas: ' + esc(strategyNames.join(', ')) : '');
    if (el.activateBtn) {
      el.activateBtn.disabled = !permissions.canDeclare || state.actionLock;
    }
    renderStrategies();
  }

  function computeAffectedServices() {
    var filtered = core.computeAffectedServices(state.services, state.selected, coreCtx());
    state.affectedServices = filtered;
    var stillActive = false;
    for (var k = 0; k < filtered.length; k++) {
      if (String(filtered[k].idactivo) === String(state.activeServiceId)) {
        stillActive = true;
        break;
      }
    }
    state.activeServiceId = stillActive ? state.activeServiceId : (filtered.length ? filtered[0].idactivo : null);
  }

  function getNodePositions(count) {
    var presets = {
      1: [{ x: 50, y: 50 }],
      2: [{ x: 32, y: 46 }, { x: 68, y: 46 }],
      3: [{ x: 50, y: 22 }, { x: 30, y: 64 }, { x: 72, y: 58 }],
      4: [{ x: 26, y: 34 }, { x: 50, y: 20 }, { x: 74, y: 34 }, { x: 50, y: 70 }],
      5: [{ x: 22, y: 36 }, { x: 38, y: 20 }, { x: 76, y: 36 }, { x: 74, y: 62 }, { x: 40, y: 68 }],
      6: [{ x: 20, y: 36 }, { x: 38, y: 20 }, { x: 62, y: 20 }, { x: 80, y: 36 }, { x: 72, y: 64 }, { x: 38, y: 66 }],
      7: [{ x: 18, y: 36 }, { x: 34, y: 18 }, { x: 52, y: 16 }, { x: 76, y: 30 }, { x: 82, y: 56 }, { x: 62, y: 72 }, { x: 32, y: 66 }],
      8: [{ x: 18, y: 34 }, { x: 30, y: 18 }, { x: 52, y: 14 }, { x: 74, y: 22 }, { x: 84, y: 42 }, { x: 76, y: 66 }, { x: 54, y: 76 }, { x: 28, y: 64 }]
    };
    if (presets[count]) {
      return presets[count];
    }
    var positions = [];
    if (!count) { return positions; }
    for (var i = 0; i < count; i++) {
      var angle = (-Math.PI / 2) + ((Math.PI * 2 * i) / count);
      positions.push({
        x: 50 + Math.cos(angle) * 34,
        y: 46 + Math.sin(angle) * 28
      });
    }
    return positions;
  }

  function getActiveService() {
    for (var i = 0; i < state.affectedServices.length; i++) {
      if (String(state.affectedServices[i].idactivo) === String(state.activeServiceId)) {
        return state.affectedServices[i];
      }
    }
    return state.affectedServices.length ? state.affectedServices[0] : null;
  }

  function renderKpis() {
    if (!state.affectedServices.length) {
      el.impactoKpis.innerHTML = '';
      return;
    }
    var minRto = null;
    var minRpo = null;
    var totalLossHour = 0;
    var criticalCount = 0;
    for (var i = 0; i < state.affectedServices.length; i++) {
      var svc = state.affectedServices[i];
      totalLossHour += svc.perdida_h || 0;
      if (svc.is_critico) { criticalCount++; }
      if (svc.rto_h > 0 && (minRto === null || svc.rto_h < minRto)) { minRto = svc.rto_h; }
      if (svc.rpo_h > 0 && (minRpo === null || svc.rpo_h < minRpo)) { minRpo = svc.rpo_h; }
    }
    var cards = [
      { label: 'Escenarios activos', value: Object.keys(state.selected).length, meta: Object.keys(state.selected).join(' + '), pct: Math.min(100, Object.keys(state.selected).length * 14) },
      { label: 'Servicios expuestos', value: state.affectedServices.length, meta: criticalCount + ' con impacto crítico', pct: Math.min(100, state.affectedServices.length * 4) },
      { label: 'RTO más exigente', value: fmtHoras(minRto), meta: 'Ventana más restrictiva', pct: minRto ? Math.max(12, 100 - Math.min(90, minRto * 10)) : 12 },
      { label: 'RPO más exigente', value: fmtHoras(minRpo), meta: 'Tolerancia a pérdida de datos', pct: minRpo ? Math.max(12, 100 - Math.min(90, minRpo * 30)) : 12 },
      { label: 'Pérdida / hora', value: fmtEur(totalLossHour), meta: 'Exposición económica combinada', pct: Math.min(100, totalLossHour / 250) }
    ];
    var html = '';
    for (var c = 0; c < cards.length; c++) {
      html += '<div class="cc-kpi-card">' +
        '<span class="cc-kpi-label">' + esc(cards[c].label) + '</span>' +
        '<strong class="cc-kpi-value">' + esc(cards[c].value) + '</strong>' +
        '<div class="cc-kpi-track"><span style="width:' + Math.max(4, Math.min(100, cards[c].pct)) + '%"></span></div>' +
        '<span class="cc-kpi-meta">' + esc(cards[c].meta) + '</span>' +
      '</div>';
    }
    el.impactoKpis.innerHTML = html;
  }

  var ESTRATEGIA_PDF_URL = (config.links && config.links.estrategia_recuperacion) || '#';

  function renderStrategyTarget(target, strategies, compact) {
    if (!target) { return; }
    if (!strategies.length) {
      target.innerHTML = compact
        ? '<div class="cc-command-empty" style="font-size:11px">Selecciona escenarios para ver estrategias.</div>'
        : '<div class="cp-empty">Sin estrategias configuradas para los escenarios activos.</div>';
      return;
    }
    var html = compact ? '' : '';
    for (var i = 0; i < strategies.length; i++) {
      var st = strategies[i];
      var emasUrl = st.idactivo ? getAssetUrl(st.idactivo) : '';
      if (compact) {
        var isActive = st.activeScenarios && st.activeScenarios.length > 0;
        var activeMeta = isActive ? st.activeScenarios.join(', ') : st.scenarios.join(', ');
        // Click: abre el detalle de la estrategia
        var chipClick = emasUrl ? '' : '';
        html += '<div class="cp-est-chip' + (isActive ? ' is-active' : '') + '" data-st-code="' + esc(st.code) + '" style="cursor:pointer">' +
          (emasUrl
            ? '<a href="' + esc(emasUrl) + '" target="_blank" rel="noopener" class="cp-est-code cp-est-code--link" onclick="event.stopPropagation()">' + esc(st.code) + '</a>'
            : '<span class="cp-est-code">' + esc(st.code) + '</span>') +
          '<span class="cp-est-title">' + esc(st.title) + '</span>' +
          (activeMeta ? '<span class="cp-est-meta">' + esc(activeMeta) + '</span>' : '') +
        '</div>';
      } else {
        html += '<div class="cc-history-card cc-history-card--strategy">' +
          '<span class="cc-history-label">' + esc(st.code) + '</span>' +
          '<strong>' + esc(st.title) + '</strong>' +
          '<p>' + esc(st.detail) + (st.scenarios.length ? ' · Escenarios: ' + esc(st.scenarios.join(', ')) : '') + '</p>' +
        '</div>';
      }
    }
    target.innerHTML = html;
    // Chip click: abre el detalle de la estrategia
    if (compact) {
      var chips = target.querySelectorAll('.cp-est-chip');
      chips.forEach(function(chip) {
        chip.addEventListener('click', function(e) {
          if (e.target.closest('a')) { return; } // let link handle it
          var code = chip.getAttribute('data-st-code');
          var strategy = null;
          for (var si = 0; si < strategies.length; si++) {
            if (strategies[si].code === code) { strategy = strategies[si]; break; }
          }
          if (strategy) {
            openStrategyDrawer(strategy);
          }
        });
      });
    }
  }

  function openStrategyDrawer(st) {
    var existing = document.getElementById('cp-est-drawer');
    if (existing) { existing.parentNode.removeChild(existing); }
    var emasUrl = st.idactivo ? getAssetUrl(st.idactivo) : '';
    var drawer = document.createElement('div');
    drawer.id = 'cp-est-drawer';
    drawer.className = 'cp-est-drawer';
    var descHtml = st.descripcion
      ? '<p class="cp-est-drawer__desc">' + esc(st.descripcion) + '</p>'
      : (emasUrl ? '' : '');
    var activeLabel = (st.activeScenarios && st.activeScenarios.length)
      ? '<span class="cp-est-drawer__active">✓ Activa con: ' + esc(st.activeScenarios.join(', ')) + '</span>'
      : '<span class="cp-est-drawer__inactive">Escenarios: ' + esc(st.scenarios.join(', ')) + '</span>';
    drawer.innerHTML =
      '<div class="cp-est-drawer__head">' +
        '<span class="cp-est-drawer__code">' + esc(st.code) + '</span>' +
        '<button class="cp-est-drawer__close" type="button">×</button>' +
      '</div>' +
      '<p class="cp-est-drawer__title">' + esc(st.title) + '</p>' +
      activeLabel +
      descHtml +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">' +
        (emasUrl ? '' : '') +
        '<a href="' + esc(PDF_URL) + '" target="_blank" rel="noopener" class="cp-est-drawer__link">📄 Ver documento</a>' +
      '</div>';
    drawer.querySelector('.cp-est-drawer__close').addEventListener('click', function() {
      drawer.parentNode && drawer.parentNode.removeChild(drawer);
    });
    document.body.appendChild(drawer);
    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', function onOutside(e) {
        if (!drawer.contains(e.target)) {
          drawer.parentNode && drawer.parentNode.removeChild(drawer);
          document.removeEventListener('click', onOutside);
        }
      });
    }, 50);
  }

  var PDF_URL = (config.links && config.links.estrategia_recuperacion) || '#';

  function renderStrategies() {
    var strategies = getUniqueStrategies();
    renderStrategyTarget(el.activationStrategies, strategies, true);
    renderStrategyTarget(el.levelStrategies, strategies, false);
  }

  function renderConstellation() {
    if (!state.affectedServices.length) {
      var emptyMessage = !state.services.length
        ? 'No hay servicios cargados en el catálogo. El análisis no puede calcular afectación real.'
        : 'Ningún servicio supera el umbral de exposición para los escenarios activos.';
      el.constellation.innerHTML = '<div class="cp-empty" style="margin:16px">' + esc(emptyMessage) + '</div>';
      return;
    }
    var services = state.affectedServices.slice(0, 10);
    var positions = getNodePositions(services.length);
    var elapsed = getElapsed();
    var lines = '<svg class="cc-link-canvas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
    var hud = '' +
      '<div class="cc-tactical-grid" aria-hidden="true">' +
        '<span class="cc-ring cc-ring--1"></span>' +
        '<span class="cc-ring cc-ring--2"></span>' +
        '<span class="cc-ring cc-ring--3"></span>' +
        '<span class="cc-crosshair cc-crosshair--h"></span>' +
        '<span class="cc-crosshair cc-crosshair--v"></span>' +
        '<span class="cc-sweep"></span>' +
      '</div>';
    var nodes = '<div class="cc-core-glow" aria-hidden="true"></div>' +
      '<div class="cc-core"><span class="cc-core__eyebrow">Servicios</span><strong>' + esc(String(services.length)) + '</strong><span class="cc-core__sub">bajo presión</span></div>';
    for (var i = 0; i < services.length; i++) {
      var svc = services[i];
      var pos = positions[i];
      var dx = pos.x - 50;
      var dy = pos.y - 46;
      var distance = Math.sqrt(dx * dx + dy * dy) || 1;
      var tone = serviceTone(svc, elapsed);
      var size = 58 + Math.min(36, Math.max(0, (svc.is_critico ? 18 : 0) + (svc.perdida_h / 280)));
      var hubOffset = 8.4;
      var nodeOffset = Math.max(5.4, Math.min(8.8, size / 12));
      var x1 = 50 + (dx / distance) * hubOffset;
      var y1 = 46 + (dy / distance) * hubOffset;
      var x2 = pos.x - (dx / distance) * nodeOffset;
      var y2 = pos.y - (dy / distance) * nodeOffset;
      var toneLabel = tone === 'critical' ? 'MTPD' : tone === 'danger' ? 'RTO OUT' : tone === 'warn' ? 'RTO 75%' : 'OK';
      lines += '<line class="cc-link-line cc-link-line--' + toneClassName(tone) + '" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"></line>';
      nodes += '<button type="button" class="cc-node cc-node--' + tone + (String(state.activeServiceId) === String(svc.idactivo) ? ' is-active' : '') + '" data-id="' + esc(svc.idactivo) + '" style="--x:' + pos.x.toFixed(2) + ';--y:' + pos.y.toFixed(2) + ';--size:' + size + '"><span class="cc-node__label">' + esc(svc.codigo || 'S') + '</span><span class="cc-node__meta">' + esc(toneLabel) + '</span></button>';
    }
    lines += '</svg>';
    el.constellation.innerHTML = hud + lines + nodes;
    var summaryEl = document.getElementById('cp-constellation-summary');
    if (summaryEl) {
      if (state.affectedServices.length > services.length) {
        summaryEl.textContent = 'Mostrando ' + services.length + ' de ' + state.affectedServices.length + ' servicios · ver todos en Servicios RTO.';
        summaryEl.hidden = false;
      } else {
        summaryEl.hidden = true;
      }
    }
    var nodeButtons = el.constellation.querySelectorAll('.cc-node');
    for (var n = 0; n < nodeButtons.length; n++) {
      nodeButtons[n].addEventListener('click', function () {
        state.activeServiceId = this.getAttribute('data-id');
        renderConstellation();
        renderServiceRail();
        renderDrawer();
      });
    }
  }

  function renderDrawer() {
    var svc = getActiveService();
    if (!svc) {
      closeSvcOverlay();
      return;
    }
    var elapsed = getElapsed();
    var tone = serviceTone(svc, elapsed);
    var progress = serviceProgress(svc, elapsed);
    var toneColors = { critical: '#f87171', danger: '#fb923c', warn: '#fbbf24', ok: '#4ade80' };
    var toneColor = toneColors[toneClassName(tone)] || '#4ade80';
    el.drawer.innerHTML =
      '<button type="button" class="cp-svc-overlay__close" id="cp-svc-close-inner" aria-label="Cerrar">✕</button>' +
      '<div class="cp-svc-header">' +
        '<div class="cp-svc-header__left">' +
          '<span class="cc-drawer-code cc-asset-link" data-asset-id="' + esc(svc.idactivo || '') + '">' + esc(svc.codigo || '') + '</span>' +
          '<h3 class="cp-svc-title">' + esc(svc.nombre || '') + '</h3>' +
        '</div>' +
        '<span class="cc-tone-badge cc-tone-badge--' + toneClassName(tone) + '">' + esc(zoneText(svc, elapsed)) + '</span>' +
      '</div>' +
      '<div class="cp-svc-rto-bar"><div class="cp-svc-rto-bar__fill" style="width:' + progress + '%;background:' + toneColor + '"></div></div>' +
      '<div class="cp-svc-metrics">' +
        '<div class="cp-svc-metric"><span>RTO</span><strong>' + esc(fmtHoras(svc.rto_h)) + '</strong></div>' +
        '<div class="cp-svc-metric"><span>RPO</span><strong>' + esc(fmtHoras(svc.rpo_h)) + '</strong></div>' +
        '<div class="cp-svc-metric"><span>MTPD</span><strong>' + esc(fmtHoras(svc.mtpd_h)) + '</strong></div>' +
        '<div class="cp-svc-metric cp-svc-metric--loss"><span>€/hora</span><strong>' + esc(fmtEur(svc.perdida_h)) + '</strong></div>' +
      '</div>' +
      '<div class="cp-svc-rows">' +
        '<div class="cp-svc-row"><span>Impacto reputacional</span><strong class="cp-svc-impact cp-svc-impact--' + toneClassName(impactTone(svc.impactoreputacional || '').cls) + '">' + esc(svc.impactoreputacional || 'No definido') + '</strong></div>' +
        '<div class="cp-svc-row"><span>Responsable</span><strong>' + esc(svc.responsable.name) + (svc.responsable.email ? '<br><a class="cp-svc-email" href="mailto:' + esc(svc.responsable.email) + '">' + esc(svc.responsable.email) + '</a>' : '') + '</strong></div>' +
        '<div class="cp-svc-row"><span>Escenarios</span><strong>' + esc((svc.matchedScenarios || []).join(' + ')) + '</strong></div>' +
        '<div class="cp-svc-row"><span>Exposición</span><strong>' + esc((svc.max_prob || 0) + '%') + (svc.n_bu_relacionada ? ' · ' + esc(svc.n_bu_relacionada) : '') + '</strong></div>' +
        (svc.justifimpactoreputacional ? '<div class="cp-svc-row cp-svc-row--note"><span>Justificación</span><span class="cp-svc-note">' + esc(svc.justifimpactoreputacional) + '</span></div>' : '') +
      '</div>';
    openSvcOverlay();
    // wire close button inside drawer (re-created on every render)
    var innerClose = document.getElementById('cp-svc-close-inner');
    if (innerClose) { innerClose.addEventListener('click', closeSvcOverlay); }
  }

  function renderServiceRail() {
    if (!state.affectedServices.length) {
      el.serviceRail.innerHTML = '<div class="cc-command-empty">Analiza el incidente para ver la lista priorizada por RTO.</div>';
      return;
    }
    var elapsed = getElapsed();
    var html = '';
    for (var i = 0; i < state.affectedServices.length; i++) {
      var svc = state.affectedServices[i];
      var tone = serviceTone(svc, elapsed);
      html += '<button type="button" class="cc-service-item' + (String(state.activeServiceId) === String(svc.idactivo) ? ' is-active' : '') + '" data-id="' + esc(svc.idactivo) + '">' +
        '<div class="cc-service-item-main">' +
          '<div class="cc-service-item-head">' +
            '<span class="cc-service-code cc-asset-link" data-asset-id="' + esc(svc.idactivo || '') + '">' + esc(svc.codigo || '') + '</span>' +
            '<span class="cc-service-name">' + esc(svc.nombre || '') + '</span>' +
            '<span class="cc-zone-badge cc-zone-badge--' + toneClassName(tone) + '" id="zone-' + esc(svc.idactivo) + '">' + esc(zoneText(svc, elapsed)) + '</span>' +
          '</div>' +
          '<div class="cc-service-rail-meta"><span>RTO ' + esc(fmtHoras(svc.rto_h)) + '</span><span>RPO ' + esc(fmtHoras(svc.rpo_h)) + '</span><span>MTPD ' + esc(fmtHoras(svc.mtpd_h)) + '</span><span>' + esc(svc.impact.text) + '</span></div>' +
          '<div class="cc-service-rail-track"><span id="bar-rto-' + esc(svc.idactivo) + '" style="width:' + serviceProgress(svc, elapsed) + '%"></span></div>' +
        '</div>' +
        '<div class="cc-service-item-side"><span class="cc-loss-hour">' + esc(fmtEur(svc.perdida_h)) + '/h</span><span class="cc-zone-badge cc-zone-badge--' + toneClassName(tone) + '" id="timer-rto-' + esc(svc.idactivo) + '">' + esc(getTimerText(svc, elapsed)) + '</span></div>' +
      '</button>';
    }
    el.serviceRail.innerHTML = html;
    var buttons = el.serviceRail.querySelectorAll('.cc-service-item');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function () {
        state.activeServiceId = this.getAttribute('data-id');
        renderServiceRail();
        renderConstellation();
        renderDrawer();
      });
    }
  }




  function computeIncidentLevel() {
    state.levelSummary = core.computeIncidentLevel({ selected: state.selected, affected: state.affectedServices,
      elapsed: getElapsed(), lastLoss: state.lastLoss, ctx: coreCtx() });
    return state.levelSummary;
  }

  function renderLevel() {
    if (!el.levelWrap) { return; }
    var summary = computeIncidentLevel();
    if (!summary) {
      el.levelWrap.className = 'cc-level-wrap';
      el.levelWrap.innerHTML = '<div class="cc-command-empty">Analiza el incidente para calcular el nivel.</div>';
      return;
    }
    var reasonsHtml = '';
    for (var i = 0; i < summary.reasons.length; i++) {
      reasonsHtml += '<li>' + esc(summary.reasons[i]) + '</li>';
    }
    var hardHtml = '';
    if (summary.hardTriggers.length) {
      var hardLines = '';
      for (var j = 0; j < summary.hardTriggers.length; j++) {
        hardLines += '<li>' + esc(summary.hardTriggers[j]) + '</li>';
      }
      hardHtml = '<div class="cc-level-trigger"><strong>Criterios de escalada automática</strong><ul>' + hardLines + '</ul></div>';
    }
    var ctaHtml = summary.committeeRecommended
      ? '<div class="cc-level-actions"><button type="button" class="cc-btn cc-btn--primary" data-go-tab="committee">Ir a Comité</button></div>'
      : '';
    el.levelWrap.className = 'cc-level-wrap is-level-' + summary.level;
    el.levelWrap.innerHTML =
      '<div class="cc-level-top">' +
        '<span class="cc-level-badge">N' + esc(String(summary.level)) + '</span>' +
        '<div><strong class="cc-level-title">' + esc(summary.title) + '</strong><p class="cc-level-note">' + esc(summary.note) + '</p></div>' +
      '</div>' +
      '<div class="cc-level-metrics">' +
        '<div class="cc-level-metric"><span>Base escenario</span><strong>N' + esc(String(summary.baseLevel)) + '</strong></div>' +
        '<div class="cc-level-metric"><span>Servicios</span><strong>' + esc(String(summary.affected)) + '</strong></div>' +
        '<div class="cc-level-metric"><span>RTO mínimo</span><strong>' + esc(fmtHoras(summary.minRto)) + '</strong></div>' +
        '<div class="cc-level-metric"><span>Pérdida/hora</span><strong>' + esc(fmtEur(summary.totalLossHour)) + '</strong></div>' +
      '</div>' +
      '<div class="cc-level-detail"><strong>Motivos de cálculo</strong><ul>' + reasonsHtml + '</ul></div>' +
      hardHtml +
      '<div class="cc-level-foot ' + (summary.committeeRecommended ? 'is-committee' : '') + '">' +
        (summary.committeeRecommended ? 'Se recomienda activar el comité de continuidad.' : 'No se requiere activación de comité en este momento.') +
      '</div>' +
      ctaHtml;
  }

    function setFichaLockState(isOpen) {
    if (el.fichaBtn) {
      el.fichaBtn.disabled = !isOpen;
      if (isOpen) { el.fichaBtn.classList.add('btn-pulse'); }
      else { el.fichaBtn.classList.remove('btn-pulse'); }
    }
    if (el.fichaLockStatus) {
      var lockLabel = isOpen
        ? (state.desastreDeclarado ? 'Desbloqueada · Condición de desastre' : 'Desbloqueada · Nivel requiere comité')
        : 'Bloqueada · Nivel insuficiente para convocar comité';
      el.fichaLockStatus.textContent = lockLabel;
      el.fichaLockStatus.classList.toggle('is-open', isOpen);
    }
  }

  function updateActionButtons() {
    var status = state.activation ? (state.activation.status || 'active') : 'none';
    var hasActivation = !!state.activation;
    updateActivateCtaContent();
    if (el.activateBtn) {
      el.activateBtn.disabled = state.actionLock || !permissions.canDeclare || !Object.keys(state.selected).length;
    }
    if (el.containBtn) {
      el.containBtn.disabled = state.actionLock || !permissions.canOperate || !hasActivation || status !== 'active';
    }
    if (el.resumeBtn) {
      el.resumeBtn.disabled = state.actionLock || !permissions.canOperate || !hasActivation || status !== 'contained';
    }
    if (el.closeBtn) {
      el.closeBtn.disabled = state.actionLock || !permissions.canClose || !hasActivation || status === 'closed';
    }
  }

  function buildCommitteeMailPayload() {
    var recipients = getCommitteeRecipients();
    var summary = computeIncidentLevel() || state.levelSummary || {};
    var scenarioCodes = Object.keys(state.selected);
    var criticalCount = 0;
    var exceededMtpd = 0;
    var elapsed = getElapsed();
    for (var i = 0; i < state.affectedServices.length; i++) {
      if (state.affectedServices[i].is_critico) { criticalCount++; }
      if (state.affectedServices[i].mtpd_s > 0 && elapsed >= state.affectedServices[i].mtpd_s) { exceededMtpd++; }
    }
    var levelText = summary.level ? (summary.title || ('N' + summary.level)) : 'Sin nivel calculado';
    var situation = state.desastreDeclarado ? 'Se ha alcanzado condición de desastre y procede activación formal del comité.' : (summary.committeeRecommended ? 'Se recomienda activación preventiva del comité de continuidad.' : 'Seguimiento reforzado sin activación formal en este momento.');
    var subject = '[Continuidad] Comité de continuidad · ' + (summary.level ? ('N' + summary.level) : 'Seguimiento') + ' · ' + (scenarioCodes.length ? scenarioCodes.join('+') : 'Incidente');
    // Build scenario + category detail line
    var scenarioDetailLines = [];
    for (var si = 0; si < scenarioCodes.length; si++) {
      var scode = scenarioCodes[si];
      var smaster = getScenarioMaster(scode);
      var catNum = parseInt(state.selected[scode] || 1, 10);
      var catDescs = [smaster.categoria_1, smaster.categoria_2, smaster.categoria_3];
      var catDesc = catDescs[catNum - 1] || '';
      scenarioDetailLines.push('  · ' + scode + ' — Categoría ' + catNum + (catDesc ? ': ' + catDesc.substring(0, 80) + (catDesc.length > 80 ? '…' : '') : ''));
    }
    var bodyLines = [
      'Estimados miembros del Comité de Continuidad,',
      '',
      situation,
      '',
      '─── RESUMEN DEL INCIDENTE ───',
      '• Nivel de gravedad: ' + levelText,
      '• Tiempo transcurrido: ' + fmtHMS(elapsed),
      '• Pérdida acumulada estimada: ' + fmtEur(state.lastLoss || 0),
      '• Pérdida estimada por hora: ' + fmtEur(summary.totalLossHour || 0),
      '',
      '─── ESCENARIOS DECLARADOS ───',
    ].concat(scenarioDetailLines).concat([
      '',
      '─── IMPACTO SOBRE SERVICIOS ───',
      '• Servicios en ventana de continuidad: ' + state.affectedServices.length,
      '• Servicios críticos afectados: ' + criticalCount,
      '• RTO más exigente: ' + fmtHoras(summary.minRto),
      '• Servicios con MTPD superado: ' + exceededMtpd,
      '',
      '─── PRÓXIMOS PASOS ───',
      '1. Consultar el panel táctico en tiempo real: ' + location.href.split('#')[0],
      '2. Revisar la ficha operativa adjunta y validar la decisión de escalado.',
      '3. Confirmar disponibilidad y activar el plan de recuperación si procede.',
      '',
      'Este mensaje ha sido generado automáticamente por el Impact Scan del Copiloto de Continuidad.'
    ]);
    return {
      recipients: recipients,
      subject: subject,
      body: bodyLines.join('\n')
    };
  }

  function renderCommittee() {
    var links = config.links || {};
    var lead = { name: config.lead_name || 'Responsable de Continuidad', role: config.lead_role || '', email: config.lead_email || '' };
    var seen = {};
    var people = [];
    for (var i = 0; i < state.affectedServices.length; i++) {
      var svc = state.affectedServices[i];
      var key = svc.responsable.name + '|' + svc.responsable.email;
      if (!seen[key]) {
        seen[key] = true;
        people.push({ name: svc.responsable.name, email: svc.responsable.email, servicio: (svc.codigo || '') + ' ' + (svc.nombre || '') });
      }
    }
    var previewPeople = people.slice(0, 8);
    var peopleHtml = '';
    for (var p = 0; p < previewPeople.length; p++) {
      var person = previewPeople[p];
      peopleHtml += '<div class="cc-contact-card"><div class="cc-contact-avatar">' + esc((person.name || '?').slice(0, 2).toUpperCase()) + '</div><div><strong>' + esc(person.name) + '</strong><small>' + esc(person.email || 'Responsable') + '</small><small>' + esc(person.servicio) + '</small></div></div>';
    }
    var mailData = buildCommitteeMailPayload();
    var notifyHtml = '';
    var linksHtml = '';
    if (links.team_directory) { linksHtml += '<a class="cc-action-link" href="' + esc(links.team_directory) + '" target="_blank" rel="noopener">Directorio del equipo de respuesta</a>'; }
    if (links.continuity_plan) { linksHtml += '<a class="cc-action-link" href="' + esc(links.continuity_plan) + '" target="_blank" rel="noopener">Plan de gestión de incidentes</a>'; }
    if (links.estrategia_recuperacion) { linksHtml += '<a class="cc-action-link" href="' + esc(links.estrategia_recuperacion) + '" target="_blank" rel="noopener">Estrategia de recuperación</a>'; }
    var moreHtml = '';
    var mailtoHtml = mailData.recipients.length
      ? '<div class="cc-command-block"><a class="cc-btn cc-btn--ghost" style="width:100%;text-align:center" href="mailto:' + encodeURIComponent(mailData.recipients.join(';')) + '?subject=' + encodeURIComponent(mailData.subject) + '&body=' + encodeURIComponent(mailData.body) + '">✉ Enviar convocatoria al comité</a></div>'
      : '';
    el.commandCenter.innerHTML = '<div class="cc-command-block"><span class="cc-command-title">Coordinación</span><div class="cc-contact-card is-lead"><div class="cc-contact-avatar">RC</div><div><strong>' + esc(lead.name) + '</strong><small>' + esc(lead.role || '') + (lead.email ? ' · ' + esc(lead.email) : '') + '</small></div></div></div>' +
      mailtoHtml +
      '<div class="cc-command-block"><span class="cc-command-title">Documentos operativos</span><div class="cc-action-list">' + linksHtml + '</div></div>';
    // Unlock committee button if disaster declared OR level recommends committee
    var summary = computeIncidentLevel() || state.levelSummary || {};
    var shouldUnlock = permissions.canCommittee && (state.desastreDeclarado || (summary && summary.committeeRecommended));
    setFichaLockState(shouldUnlock);
    updateActionButtons();
  }

  function statusLabel(status) {
    if (status === 'closed') { return '<span class="cp-htbadge cp-htbadge--closed">Cerrado</span>'; }
    if (status === 'contained') { return '<span class="cp-htbadge cp-htbadge--contained">Pausado</span>'; }
    return '<span class="cp-htbadge cp-htbadge--active">Activo</span>';
  }

  function renderHistory() {
    if (!state.history || !state.history.length) {
      el.historyWrap.innerHTML = '<div class="cp-empty">No hay activaciones registradas todavía.</div>';
      if (el.historyExportBtn) { el.historyExportBtn.style.display = 'none'; }
      return;
    }
    if (el.historyExportBtn) { el.historyExportBtn.style.display = ''; }
    var html = '<div class="cp-htable-wrap"><table class="cp-htable"><thead><tr>' +
      '<th>#</th><th>Estado</th><th>Escenarios</th><th>Declarado</th><th>Declaró</th>' +
      '<th>Resolución</th><th>Cierre</th><th>Pérdida final</th><th></th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < state.history.length; i++) {
      var item = state.history[i];
      var scenarios = item.scenarios && item.scenarios.join ? item.scenarios.join(' + ') : '—';
      var isOpenable = (item.status === 'active' || item.status === 'contained') && permissions.canClose;
      var rowClass = item.status === 'active' ? ' class="cp-hrow--active"' : item.status === 'contained' ? ' class="cp-hrow--contained"' : '';
      html += '<tr' + rowClass + '>' +
        '<td class="cp-htd-id">#' + esc(item.id) + '</td>' +
        '<td>' + statusLabel(item.status || 'active') + '</td>' +
        '<td class="cp-htd-scenarios"><strong>' + esc(scenarios) + '</strong></td>' +
        '<td class="cp-htd-date">' + esc(fmtDate(item.created_at_gmt)) + '</td>' +
        '<td class="cp-htd-user">' + esc(item.created_by_user_login || item.user_login || '—') + '</td>' +
        '<td class="cp-htd-date">' + esc(fmtDate(item.contained_at_gmt)) + '</td>' +
        '<td class="cp-htd-date">' + esc(fmtDate(item.closed_at_gmt)) + '</td>' +
        '<td class="cp-htd-loss">' + esc(fmtEur(parseFloat(item.loss_total || 0))) + '</td>' +
        '<td>' + (isOpenable ? '<button type="button" class="cc-btn cc-btn--ghost cp-history-close-btn cp-htclose" data-id="' + esc(item.id) + '">Cerrar</button>' : '') + '</td>' +
      '</tr>';
    }
    html += '</tbody></table></div>';
    el.historyWrap.innerHTML = html;
  }

  function exportHistoryCsv() {
    if (!state.history || !state.history.length) { return; }
    var rows = [['#', 'Estado', 'Escenarios', 'Declarado (UTC)', 'Declaró', 'Resolución (UTC)', 'Cierre (UTC)', 'Pérdida final (€)', 'Desastre (UTC)', 'Desastre declarado por']];
    for (var i = 0; i < state.history.length; i++) {
      var item = state.history[i];
      rows.push([
        item.id,
        item.status || 'active',
        item.scenarios && item.scenarios.join ? item.scenarios.join('+') : '',
        item.created_at_gmt || '',
        item.created_by_user_login || item.user_login || '',
        item.contained_at_gmt || '',
        item.closed_at_gmt || '',
        parseFloat(item.loss_total || 0).toFixed(2),
        item.disaster_at_gmt || '',
        item.disaster_by_user_login || ''
      ]);
    }
    var csv = rows.map(function(r) {
      return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'historial-incidente-continuidad-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function renderMode2() {
    if (el.thresholdLossLabel) {
      el.thresholdLossLabel.textContent = fmtEur(UMBRAL_PERDIDA_EUR);
    }
    if (!state.affectedServices.length) {
      el.impactHeadline.textContent = !state.services.length ? 'Sin datos de servicios' : 'Sin servicios expuestos';
      el.impactSubline.textContent = !state.services.length
        ? 'El catálogo no contiene servicios. El incidente sigue activo, pero el análisis no puede calcular afectación real.'
        : 'Ningún servicio supera el umbral de exposición para los escenarios activos.';
      el.constellation.innerHTML = '<div class="cp-empty" style="margin:16px">' + esc(el.impactSubline.textContent) + '</div>';
      el.drawer.innerHTML = '<div class="cc-command-empty">Selecciona un servicio para ver su lectura táctica.</div>';
      el.serviceRail.innerHTML = '<div class="cc-command-empty">No hay servicios priorizados para mostrar.</div>';
      renderStrategies();
      el.impactoKpis.innerHTML = '';
      renderLevel();
      updateRoomStrip();
      return;
    }
    var keys = Object.keys(state.selected);
    var labels = [];
    for (var i = 0; i < keys.length; i++) {
      labels.push(getScenarioMaster(keys[i]).short || keys[i]);
    }
    el.impactHeadline.textContent = 'Servicios bajo presión';
    el.impactSubline.textContent = labels.join(' · ') + ' · ' + state.affectedServices.length + ' servicios en ventana de continuidad';
    renderKpis();
    renderStrategies();
    renderConstellation();
    renderServiceRail();
    renderDrawer();
    renderLevel();
    updateRoomStrip();
  }

  function syncDisaster(reason) {
    if (!state.activation || state.disasterSynced) {
      return;
    }
    ajax('status', {
      activation_id: state.activation.id,
      status_action: 'disaster',
      loss_total: state.lastLoss,
      reason: reason || 'threshold'
    }, function (resp) {
      if (!resp || resp.success === false) {
        state.disasterSynced = false;
        setViewNotice((resp && resp.data && resp.data.mensaje) || 'No se ha podido sincronizar la condición de desastre con la base de datos. Se reintentará automáticamente.', 'warn');
        return;
      }
      state.disasterSynced = true;
      var payload = resp.data ? resp.data : resp;
      if (payload.activation) {
        state.activation = payload.activation;
        updateChip();
        updateIncidentStatusChip();
      }
      if (payload.history) {
        state.history = payload.history;
        renderHistory();
      }
    });
  }

  function updateStatus(action, reason, activationId) {
    var targetId = activationId || (state.activation ? state.activation.id : 0);
    var isCurrentActivation = !activationId || (state.activation && String(targetId) === String(state.activation.id));
    if (!targetId) {
      return;
    }
    var previousPaused = state.pausedElapsed;
    var shouldResumeClock = isCurrentActivation && state.activation && state.activation.status === 'active';
    setActionLock(true, action === 'close' ? 'Cerrando…' : action === 'contain' ? 'Pausando…' : action === 'resume' ? 'Reanudando…' : 'Actualizando…');
    ajax('status', {
      activation_id: targetId,
      status_action: action,
      loss_total: state.lastLoss,
      reason: reason || ''
    }, function (resp) {
      setActionLock(false);
      if (!resp || resp.success === false) {
        if (isCurrentActivation) {
          state.pausedElapsed = previousPaused;
          if (shouldResumeClock) {
            startLiveClock();
          }
        }
        var errorMessage = (resp && resp.data && resp.data.mensaje) || 'No se ha podido actualizar el estado del incidente.';
        setStatusText(errorMessage);
        setViewNotice(errorMessage, 'danger');
        return;
      }
      setViewNotice('', 'info');
      var payload = resp.data ? resp.data : resp;
      if (payload.activation && isCurrentActivation) {
        state.activation = payload.activation;
        hydrateClockFromActivation();
        updateChip();
        updateIncidentStatusChip();
      }
      if (payload.history) {
        state.history = payload.history;
        renderHistory();
      }
      renderCommittee();
      updateActionButtons();
      if (action === 'resume' && isCurrentActivation) {
        startLiveClock();
      }
      tickMode2();
      if (action === 'close') {
        switchTab('history');
      } else {
        switchTab('impact');
      }
      setStatusText(action === 'resume' ? 'Seguimiento reanudado.' : action === 'contain' ? 'Seguimiento pausado.' : action === 'close' ? 'Incidente cerrado.' : 'Estado actualizado.');
    });
  }

  function hydrateClockFromActivation() {
    if (!state.activation || !state.activation.created_at_gmt) {
      state.activationTs = null;
      state.onsetTs = null;
      state.pausedElapsed = null;
      state.pausedTotalSeconds = 0;
      return;
    }
    state.activationTs = new Date(state.activation.created_at_gmt);
    // onset_at_gmt = real start of outage (may predate created_at_gmt)
    state.onsetTs = state.activation.onset_at_gmt ? new Date(state.activation.onset_at_gmt) : null;
    state.pausedTotalSeconds = parseInt(state.activation.paused_total_seconds || 0, 10) || 0;
    var pausedAt = state.activation.status === 'closed'
      ? state.activation.closed_at_gmt
      : state.activation.status === 'contained'
        ? state.activation.contained_at_gmt
        : '';
    if (pausedAt) {
      var baseTs = state.onsetTs || state.activationTs;
      state.pausedElapsed = Math.max(0, ((new Date(pausedAt).getTime() - baseTs.getTime()) / 1000) - state.pausedTotalSeconds);
    } else {
      state.pausedElapsed = null;
    }
    state.desastreDeclarado = !!state.activation.disaster_at_gmt || (parseFloat(state.activation.loss_total || 0) >= UMBRAL_PERDIDA_EUR);
    state.lastLoss = parseFloat(state.activation.loss_total || 0) || 0;
    // Sync onset input field
    updateOnsetUI();
  }

  function tickMode2() {
    if (!state.activation) {
      return;
    }
    var elapsed = getElapsed();
    var totalLoss = parseFloat(state.activation.loss_total || 0) || 0;
    var criticosMtpd = 0;
    var overallTone = 'ok';
    if (state.affectedServices.length) {
      totalLoss = 0;
      for (var i = 0; i < state.affectedServices.length; i++) {
        var svc = state.affectedServices[i];
        totalLoss += (svc.perdida_h || 0) * (elapsed / 3600);
        if (svc.is_critico && svc.mtpd_s > 0 && elapsed >= svc.mtpd_s) {
          criticosMtpd++;
        }
        var tone = serviceTone(svc, elapsed);
        if (tone === 'critical') {
          overallTone = 'critical';
        } else if (tone === 'danger' && overallTone !== 'critical') {
          overallTone = 'danger';
        } else if (tone === 'warn' && overallTone === 'ok') {
          overallTone = 'warn';
        }
        var bar = document.getElementById('bar-rto-' + svc.idactivo);
        if (bar) {
          bar.style.width = serviceProgress(svc, elapsed) + '%';
          bar.style.background = tone === 'critical' || tone === 'danger' ? 'linear-gradient(90deg,#f6a0a5,#C2262E)' : tone === 'warn' ? 'linear-gradient(90deg,#ffd59e,#EA9B31)' : 'linear-gradient(90deg,#4d80f1,#0545B0)';
        }
        var timer = document.getElementById('timer-rto-' + svc.idactivo);
        if (timer) {
          timer.textContent = getTimerText(svc, elapsed);
          timer.className = 'cc-zone-badge cc-zone-badge--' + toneClassName(tone);
        }
        var zone = document.getElementById('zone-' + svc.idactivo);
        if (zone) {
          zone.textContent = zoneText(svc, elapsed);
          zone.className = 'cc-zone-badge cc-zone-badge--' + toneClassName(tone);
        }
      }
    }
    state.lastLoss = totalLoss;
    if (el.perdidaTotal) {
      el.perdidaTotal.textContent = fmtEur(totalLoss);
    }
    if (el.liveClock) {
      el.liveClock.textContent = fmtHMS(elapsed);
    }
    if (el.liveClockTone) {
      var status = state.activation.status || 'active';
      if (status === 'contained') {
        el.liveClockTone.textContent = 'Sesión pausada';
        el.liveClockTone.className = 'cc-pressure-tone is-warn';
      } else if (status === 'closed') {
        el.liveClockTone.textContent = 'Incidente cerrado';
        el.liveClockTone.className = 'cc-pressure-tone is-ok';
      } else if (state.desastreDeclarado || overallTone === 'critical') {
        el.liveClockTone.textContent = 'Umbral de desastre';
        el.liveClockTone.className = 'cc-pressure-tone is-critical';
      } else if (overallTone === 'danger') {
        el.liveClockTone.textContent = 'RTO comprometido';
        el.liveClockTone.className = 'cc-pressure-tone is-danger';
      } else if (overallTone === 'warn') {
        el.liveClockTone.textContent = 'Tensión creciente';
        el.liveClockTone.className = 'cc-pressure-tone is-warn';
      } else {
        el.liveClockTone.textContent = 'Ventana operativa';
        el.liveClockTone.className = 'cc-pressure-tone is-ok';
      }
    }

    var hayDesastre = totalLoss >= UMBRAL_PERDIDA_EUR || criticosMtpd >= UMBRAL_CRITICOS_MTPD;
    if (hayDesastre && !state.desastreDeclarado) {
      state.desastreDeclarado = true;
      if (el.desastreAlert) {
        el.desastreAlert.innerHTML = '<div class="cp-desastre-icon">!</div><div class="cp-desastre-body"><strong>Condición de desastre detectada</strong><p>Pérdida acumulada ' + esc(fmtEur(totalLoss)) + ' · Servicios críticos con MTPD superado: ' + esc(String(criticosMtpd)) + '</p><p>Se desbloquea la ficha de activación del comité.</p></div>';
        el.desastreAlert.hidden = false;
      }
      setFichaLockState(true);
      syncDisaster(totalLoss >= UMBRAL_PERDIDA_EUR ? 'loss_threshold' : 'mtpd_threshold');
    }

    updateRoomStrip();
  }

  function startLiveClock() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
    }
    if (state.activation && state.activation.status === 'active') {
      tickMode2();
      state.timerInterval = setInterval(tickMode2, 1000);
    } else {
      tickMode2();
    }
  }

  function stopLiveClock() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function generarFicha() {
    if (!state.desastreDeclarado) {
      setFichaLockState(false);
      return;
    }
    var elapsed = getElapsed();
    var horasElapsed = elapsed / 3600;
    var totalLoss = 0;
    for (var i = 0; i < state.affectedServices.length; i++) {
      totalLoss += (state.affectedServices[i].perdida_h || 0) * horasElapsed;
    }
    var scenarioKeys = Object.keys(state.selected);
    var scenarioHtml = '';
    for (var s = 0; s < scenarioKeys.length; s++) {
      var scenarioMeta = getScenarioMaster(scenarioKeys[s]);
      scenarioHtml += '<li><strong>' + esc(scenarioMeta.code) + '</strong> · ' + esc(scenarioMeta.title || scenarioMeta.code) + '</li>';
    }
    var strategyRows = '';
    var strategies = getUniqueStrategies();
    for (var st = 0; st < strategies.length; st++) {
      strategyRows += '<tr><td style="padding:8px 10px;font-weight:700;white-space:nowrap">' + esc(strategies[st].code) + '</td><td style="padding:8px 10px;font-weight:700">' + esc(strategies[st].title) + '</td><td style="padding:8px 10px;color:#475569">' + esc(strategies[st].detail) + '</td></tr>';
    }
    var svcRows = '';
    for (var r = 0; r < state.affectedServices.length; r++) {
      var svc = state.affectedServices[r];
      var loss = (svc.perdida_h || 0) * horasElapsed;
      svcRows += '<tr><td style="padding:8px 10px;font-weight:700">' + esc(svc.codigo || '') + '</td><td style="padding:8px 10px">' + esc(svc.nombre || '') + '</td><td style="padding:8px 10px">' + esc(svc.impactoreputacional || '') + '</td><td style="padding:8px 10px">' + esc(fmtHoras(svc.rto_h)) + '</td><td style="padding:8px 10px">' + esc(fmtHoras(svc.mtpd_h)) + '</td><td style="padding:8px 10px">' + esc(fmtEur(loss)) + '</td><td style="padding:8px 10px">' + esc(svc.responsable.name) + (svc.responsable.email ? '<br><span style="color:#0545B0">' + esc(svc.responsable.email) + '</span>' : '') + '</td></tr>';
    }
    var links = config.links || {};
    var refLinks = '';
    if (links.continuity_plan) { refLinks += '<li><a href="' + esc(links.continuity_plan) + '" target="_blank">Plan de gestión de incidentes</a></li>'; }
    if (links.estrategia_recuperacion) { refLinks += '<li><a href="' + esc(links.estrategia_recuperacion) + '" target="_blank">Estrategia de recuperación</a></li>'; }
    if (links.team_directory) { refLinks += '<li><a href="' + esc(links.team_directory) + '" target="_blank">Directorio del equipo de respuesta</a></li>'; }
    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Ficha de activación del comité</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#0f172a;background:#fff;padding:28px}.wrap{max-width:980px;margin:0 auto}.head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #0545B0;padding-bottom:14px;margin-bottom:20px}.title{font-size:20pt;font-weight:800;color:#0f172a;line-height:1.1}.sub{font-size:10pt;color:#475569;margin-top:6px}.meta{font-size:9pt;color:#475569;text-align:right}.alert{padding:12px 14px;border-left:4px solid #C2262E;background:#fff0f1;color:#7f1d1d;font-weight:700;border-radius:6px;margin-bottom:20px}.sec{margin-bottom:22px}.sec h2{font-size:10pt;text-transform:uppercase;letter-spacing:1px;color:#0545B0;margin:0 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:6px}ul{margin:0;padding-left:20px}li{margin-bottom:6px}table{width:100%;border-collapse:collapse;font-size:9pt}th{background:#0f172a;color:#fff;padding:8px 10px;text-align:left}td{border-bottom:1px solid #e2e8f0;vertical-align:top}tr:nth-child(even) td{background:#f8fafc}.big{font-size:16pt;font-weight:800;color:#b91c1c}.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}.line{border-top:1px solid #94a3b8;padding-top:8px;font-size:9pt}a{color:#0545B0;text-decoration:none}</style></head><body><div class="wrap"><div class="head"><div><div class="title">Ficha de activación del comité de continuidad</div><div class="sub">Impact Scan · Resumen ejecutivo para activación</div></div><div class="meta">Generada: ' + esc(fmtDate(new Date(clock.now()).toISOString())) + '<br>Activación: ' + esc(fmtDate(state.activation.created_at_gmt)) + '</div></div><div class="alert">Condición de desastre declarada. Se eleva la activación a comité de continuidad.</div><div class="sec"><h2>Escenarios declarados</h2><ul>' + scenarioHtml + '</ul></div><div class="sec"><h2>Impacto sobre servicios</h2><table><thead><tr><th>Código</th><th>Servicio</th><th>Impacto reputacional</th><th>RTO</th><th>MTPD</th><th>Pérdida acumulada</th><th>Responsable</th></tr></thead><tbody>' + svcRows + '</tbody></table></div><div class="sec"><h2>Pérdida acumulada</h2><div class="big">' + esc(fmtEur(totalLoss)) + '</div><div class="sub">Tiempo transcurrido desde la activación: ' + esc(fmtHMS(elapsed)) + '</div></div>' + (strategyRows ? '<div class="sec"><h2>Estrategias activables por escenario</h2><table><thead><tr><th>Código</th><th>Estrategia</th><th>Detalle</th></tr></thead><tbody>' + strategyRows + '</tbody></table></div>' : '') + (refLinks ? '<div class="sec"><h2>Documentos de referencia</h2><ul>' + refLinks + '</ul></div>' : '') + '<div class="sec"><h2>Firmas</h2><div class="sign"><div class="line">Declarado por</div><div class="line">Coordinación del comité</div></div></div></div></body></html>';
    el.fichaContainer.innerHTML = '<div class="cp-ficha-actions"><button type="button" class="cc-btn cc-btn--primary" id="cp-ficha-print">Imprimir ficha</button><button type="button" class="cc-btn cc-btn--ghost" id="cp-ficha-close">Cerrar</button></div><iframe id="cp-ficha-frame" style="width:100%;min-height:800px;border:1px solid rgba(153,173,204,.24);border-radius:18px;background:#fff"></iframe>';
    el.fichaContainer.hidden = false;
    var frame = document.getElementById('cp-ficha-frame');
    var frameDoc = frame ? (frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null)) : null;
    if (!frameDoc) {
      setViewNotice('No se ha podido abrir la ficha en este navegador. Prueba de nuevo o usa otro navegador.', 'warn');
      return;
    }
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();
    frame.onload = function () {
      var currentDoc = frame.contentDocument || (frame.contentWindow ? frame.contentWindow.document : null);
      if (currentDoc && currentDoc.body) {
        frame.style.height = (currentDoc.body.scrollHeight + 40) + 'px';
      }
    };
    document.getElementById('cp-ficha-print').addEventListener('click', function () { if (frame.contentWindow) { frame.contentWindow.print(); } });
    document.getElementById('cp-ficha-close').addEventListener('click', function () { el.fichaContainer.hidden = true; el.fichaContainer.innerHTML = ''; });
    switchTab('committee');
    el.fichaContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hydrateFromActivation() {
    if (!state.activation || !state.activation.scenarios || !state.activation.scenarios.length) {
      return;
    }
    state.selected = {};
    for (var i = 0; i < state.activation.scenarios.length; i++) {
      var cats = state.activation.categories || {};
      state.selected[state.activation.scenarios[i]] = parseInt(cats[state.activation.scenarios[i]] || 1, 10) || 1;
    }
    if (!impactOnly) {
      renderScenarios();
      updatePattern();
    }
    hydrateClockFromActivation();
    computeAffectedServices();
    renderMode2();
    if (!impactOnly) {
      renderCommittee();
      renderComms();
    }
    setTabAvailability(true);
    if (!impactOnly) {
      updateActionButtons();
    }
    if (impactOnly) {
      switchTab('impact');
    }
    if (state.activation.status === 'active') {
      startLiveClock();
    } else {
      stopLiveClock();
      tickMode2();
    }
  }

  function activateRoom() {
    var keys = Object.keys(state.selected);
    if (!keys.length) {
      setInlineNotice('Selecciona al menos un escenario para analizar el impacto.', 'warn');
      return;
    }
    setInlineNotice('', 'info');
    setViewNotice('', 'info');
    setActionLock(true, 'Analizando…');
    ajax('activate', { scenarios: keys, categories: state.selected }, function (resp) {
      setActionLock(false);
      if (!resp || resp.success === false) {
        var message = (resp && resp.data && resp.data.mensaje) || 'Error al lanzar el análisis del incidente.';
        setInlineNotice(message, 'danger');
        setViewNotice(message, 'danger');
        setStatusText(message);
        return;
      }
      var payload = resp.data ? resp.data : resp;
      state.activation = payload.activation || null;
      state.history = payload.history || [];
      state.disasterSynced = false;
      if (el.desastreAlert) {
        el.desastreAlert.hidden = true;
        el.desastreAlert.innerHTML = '';
      }
      if (el.fichaContainer) {
        el.fichaContainer.hidden = true;
        el.fichaContainer.innerHTML = '';
      }
      computeAffectedServices();
      updateChip();
      updateIncidentStatusChip();
      renderHistory();
      renderMode2();
      renderCommittee();
      hydrateClockFromActivation();
      startLiveClock();
      setStatusText('Impacto calculado · ' + state.affectedServices.length + ' servicios evaluados');
      setInlineNotice('', 'info');
      // Corrección respecto al original: habilitar Nivel/Servicios/Comité sin tener que recargar.
      setTabAvailability(true);
      renderComms();
      switchTab('impact');
    });
  }

  function loadContext() {
    setStatusText(data.labels && data.labels.loading ? data.labels.loading : 'Cargando catálogo de servicios…');
    setViewNotice('', 'info');
    if (el.thresholdLossLabel) {
      el.thresholdLossLabel.textContent = fmtEur(UMBRAL_PERDIDA_EUR);
    }
    ajax('context', {}, function (resp) {
      if (!resp || resp.success === false) {
        var errorMessage = (resp && resp.data && resp.data.mensaje) || (data.labels && data.labels.error) || 'No se ha podido cargar la información de continuidad.';
        state.contextError = errorMessage;
        state.services = [];
        state.scenarioRows = [];
        state.history = [];
        state.activation = null;
        renderScenarios();
        updatePattern();
        renderHistory();
        renderMode2();
        updateChip();
        updateIncidentStatusChip();
        setStatusText(errorMessage);
        setViewNotice(errorMessage, 'danger');
        return;
      }
      var payload = resp.data ? resp.data : resp;
      state.contextError = '';
      state.services = payload && Object.prototype.toString.call(payload.rows) === '[object Array]' ? payload.rows : [];
      state.scenarioRows = payload && Object.prototype.toString.call(payload.scenarios) === '[object Array]' ? payload.scenarios : [];
      state.estrategias = (payload && payload.estrategias && typeof payload.estrategias === 'object') ? payload.estrategias : {};
      state.history = payload && payload.history ? payload.history : [];
      state.activation = payload && payload.lastActivation ? payload.lastActivation : null;
      renderScenarios();
      updatePattern();
      updateChip();
      updateIncidentStatusChip();
      renderHistory();
      if (!state.scenarioRows.length && Object.keys(config.scenarios || {}).length) {
        setInlineNotice('El catálogo no incluye escenarios. Se usa la configuración interna para que el análisis siga operativo.', 'warn');
      } else {
        setInlineNotice('', 'info');
      }
      if (state.activation && state.activation.scenarios && state.activation.scenarios.length) {
        hydrateFromActivation();
        if (el.analyzeBtn) { el.analyzeBtn.disabled = false; }
      } else {
        renderMode2();
      }
      if (state.services.length) {
        setStatusText('Catálogo listo · ' + state.services.length + ' servicios cargados');
        if (!state.affectedServices.length && state.activation && state.activation.status === 'active') {
          setViewNotice('El incidente sigue activo, pero ningún servicio supera el umbral para los escenarios seleccionados.', 'warn');
        } else {
          setViewNotice('', 'info');
        }
      } else {
        setStatusText('Sin datos de servicios. Verifica el catálogo.');
        setViewNotice('El catálogo no contiene servicios. La herramienta sigue accesible, pero el análisis mostrará el incidente sin mapa de afectación.', 'warn');
      }
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // ONSET — Ajuste de hora real de inicio de indisponibilidad
  // ══════════════════════════════════════════════════════════════════════════

  function toLocalDatetimeValue(isoStr) {
    if (!isoStr) { return ''; }
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) { return ''; }
    // Format as YYYY-MM-DDTHH:MM for datetime-local input (local time)
    var pad = function(n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function updateOnsetUI() {
    if (!el.onsetInput || !el.onsetApplyBtn) { return; }
    var hasActivation = !!(state.activation && state.activation.id);
    if (!hasActivation) {
      el.onsetInput.disabled = true;
      el.onsetApplyBtn.disabled = true;
      if (el.onsetStatus) { el.onsetStatus.hidden = true; }
      return;
    }
    el.onsetInput.disabled = false;
    el.onsetApplyBtn.disabled = false;
    // Pre-fill with current onset (or activation time if none set)
    var currentOnset = state.activation.onset_at_gmt || state.activation.created_at_gmt || '';
    if (el.onsetInput.value === '' || !el.onsetInput._userEditing) {
      el.onsetInput.value = toLocalDatetimeValue(currentOnset);
    }
    // Show confirmation if onset is set
    if (state.activation.onset_at_gmt && el.onsetStatus) {
      el.onsetStatus.hidden = false;
      el.onsetStatus.className = 'cp-onset-status cp-onset-status--ok';
      var d = new Date(state.activation.onset_at_gmt);
      var diffMin = Math.round((new Date(state.activation.created_at_gmt).getTime() - d.getTime()) / 60000);
      el.onsetStatus.textContent = '✓ Inicio ajustado a ' + fmtDate(state.activation.onset_at_gmt) +
        (diffMin > 0 ? ' (' + diffMin + ' min antes del análisis)' : '');
    }
  }

  function applyOnset() {
    if (!el.onsetInput || !state.activation || !state.activation.id) { return; }
    var localVal = el.onsetInput.value; // "YYYY-MM-DDTHH:MM"
    if (!localVal) { return; }
    // Convert local datetime-local value to UTC ISO string for backend
    var localDate = new Date(localVal);
    if (isNaN(localDate.getTime())) {
      if (el.onsetStatus) {
        el.onsetStatus.hidden = false;
        el.onsetStatus.className = 'cp-onset-status cp-onset-status--err';
        el.onsetStatus.textContent = '✗ Fecha no válida.';
      }
      return;
    }
    if (localDate.getTime() > clock.now()) {
      if (el.onsetStatus) {
        el.onsetStatus.hidden = false;
        el.onsetStatus.className = 'cp-onset-status cp-onset-status--err';
        el.onsetStatus.textContent = '✗ La hora de inicio no puede ser en el futuro.';
      }
      return;
    }
    var onsetGmt = localDate.toISOString().replace('T', ' ').substring(0, 19);
    var btn = el.onsetApplyBtn;
    btn.disabled = true;
    btn.textContent = '…';

    backend.call('set_onset', { activation_id: String(state.activation.id), onset_gmt: onsetGmt })
      .then(function(res) {
        btn.disabled = false;
        btn.textContent = 'Aplicar';
        if (res.ok) {
          state.activation = res.activation;
          state.onsetTs = new Date(res.activation.onset_at_gmt);
          el.onsetInput._userEditing = false;
          updateOnsetUI();
          // Recompute elapsed-dependent visuals
          if (state.affectedServices.length) {
            renderMode2();
          }
          renderComms();
          if (el.onsetStatus) {
            el.onsetStatus.hidden = false;
            el.onsetStatus.className = 'cp-onset-status cp-onset-status--ok';
            var diffMin = Math.round((new Date(state.activation.created_at_gmt).getTime() - state.onsetTs.getTime()) / 60000);
            el.onsetStatus.textContent = '✓ Reloj actualizado.' + (diffMin > 0 ? ' Adelantado ' + diffMin + ' min.' : '');
          }
        } else {
          if (el.onsetStatus) {
            el.onsetStatus.hidden = false;
            el.onsetStatus.className = 'cp-onset-status cp-onset-status--err';
            el.onsetStatus.textContent = '✗ ' + (res.message || 'Error al guardar.');
          }
        }
      })
      .catch(function() {
        btn.disabled = false;
        btn.textContent = 'Aplicar';
        if (el.onsetStatus) {
          el.onsetStatus.hidden = false;
          el.onsetStatus.className = 'cp-onset-status cp-onset-status--err';
          el.onsetStatus.textContent = '✗ Error de red.';
        }
      });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMUNICACIONES — Tabla de notificaciones obligatorias (ISO 22301 / ENS)
  // ══════════════════════════════════════════════════════════════════════════


  // ══════════════════════════════════════════════════════════════════════════
  // COMUNICACIONES — rediseño v2.2 (minimalista, 4 preguntas)
  // ══════════════════════════════════════════════════════════════════════════

  // Contextos y el escenario ESC al que mapean
  // ctx: E3 = seguridad, E5 = cliente publico, E6 = privacidad
  var COMMS_TABLE = core.COMMS_TABLE;

  // Estado local de la pestaña
  var commsState = {
    ctx: 'seguridad',
    activeItemId: null
  };

  function commsToneClass(color) {
    var map = { critical: 'critical', danger: 'danger', warn: 'warn', ok: 'ok' };
    return map[color] || 'ok';
  }


  function buildMailtoHref(item, elapsedMin) {
    var onset = state.onsetTs || state.activationTs;
    var onsetStr = onset ? fmtDate(onset.toISOString()) : 'pendiente de confirmar';
    var elapsedStr = (elapsedMin !== null && elapsedMin !== undefined && isFinite(elapsedMin))
      ? Math.round(elapsedMin) + ' min desde el inicio'
      : '';
    var subject = '[Continuidad] ' + item.mail_asunto;
    var lines = [
      item.mail_cuerpo,
      '',
      'Datos del incidente:',
      '  Inicio: ' + onsetStr + (elapsedStr ? ' (' + elapsedStr + ')' : ''),
      '  Destinatario final: ' + item.quien,
      '  Canal: ' + item.canal,
      '  Plazo: ' + item.plazo,
      '  Evidencia a conservar: ' + item.evidencia,
      '',
      'Confirma por este hilo: aviso enviado, hora y destinatario.'
    ];
    return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
  }


  function renderCommsFicha(item, elapsedMin) {
    if (!el.commsFicha || !el.commsFichaWrap) { return; }
    var hasActivation = !!(state.activation && state.activation.id);
    var tone = commsToneClass(item.color);
    var status = getCommsStatus(item, elapsedMin);

    var mailBtn = hasActivation
      ? '<a href="' + buildMailtoHref(item, elapsedMin) + '" class="cc-btn cc-btn--lime cp-comms-mail-btn" target="_blank" rel="noopener">✉&nbsp;Abrir correo</a>'
      : '<span class="cp-comms-action-dim">Activa el incidente para generar el correo</span>';

    var extra = '';
    if (item.accion === 'link_lucia') {
      extra = ' <a href="https://www.ccn-cert.cni.es/lucia" target="_blank" rel="noopener" class="cc-btn cc-btn--ghost">Abrir LUCÍA</a>';
    }

    el.commsFicha.innerHTML =
      '<div class="cp-comms-ficha__inner cp-comms-ficha__inner--' + tone + '">' +
        '<div class="cp-comms-ficha__row">' +
          '<span class="cp-comms-ficha__label">Quién debe notificar</span>' +
          '<span class="cp-comms-ficha__val">' + esc(item.quien) + '</span>' +
        '</div>' +
        '<div class="cp-comms-ficha__row">' +
          '<span class="cp-comms-ficha__label">Canal</span>' +
          '<span class="cp-comms-ficha__val">' + esc(item.canal) + '</span>' +
        '</div>' +
        '<div class="cp-comms-ficha__row">' +
          '<span class="cp-comms-ficha__label">Plazo</span>' +
          '<span class="cp-comms-ficha__val cp-comms-ficha__val--' + esc(status.key) + '">' + esc(item.plazo) + (item.plazo_horas ? ' <em>(' + esc(status.label) + ')</em>' : '') + '</span>' +
        '</div>' +
        '<div class="cp-comms-ficha__row">' +
          '<span class="cp-comms-ficha__label">Base normativa</span>' +
          '<span class="cp-comms-ficha__val">' + esc(item.base) + '</span>' +
        '</div>' +
        '<div class="cp-comms-ficha__row">' +
          '<span class="cp-comms-ficha__label">Evidencia a conservar</span>' +
          '<span class="cp-comms-ficha__val">' + esc(item.evidencia) + '</span>' +
        '</div>' +
        '<div class="cp-comms-ficha__actions">' + mailBtn + extra + '</div>' +
      '</div>';

    el.commsFichaWrap.hidden = false;
    commsState.activeItemId = item.id;
  }

  function renderComms() {
    if (!el.commsTimeline) { return; }

    var hasActivation = !!(state.activation && state.activation.id);
    var elapsedSec = hasActivation ? getElapsed() : null;
    var elapsedMin = elapsedSec !== null ? elapsedSec / 60 : null;
    var onset = state.onsetTs || state.activationTs;
    var ctx = commsState.ctx;

    // Elapsed note
    if (el.commsElapsedNote) {
      if (onset && elapsedSec !== null) {
        el.commsElapsedNote.textContent = 'Inicio: ' + fmtDate(onset.toISOString()) + ' · ' + fmtHMS(elapsedSec) + ' transcurridos';
      } else {
        el.commsElapsedNote.textContent = 'Sin incidente activo — los plazos se calculan al declarar';
      }
    }

    var items = getCommsForCtx(ctx);

    // Pregunta 1: ¿Aplica alguna comunicación?
    if (el.commsAnswer1) {
      var mandatoryCount = 0;
      for (var m = 0; m < items.length; m++) {
        if (items[m].mandatory) { mandatoryCount++; }
      }
      if (items.length === 0) {
        el.commsAnswer1.hidden = false;
        el.commsAnswer1.className = 'cp-comms-answer cp-comms-answer--no';
        el.commsAnswer1.textContent = 'Para este contexto no hay comunicaciones regulatorias aplicables en este momento.';
      } else {
        el.commsAnswer1.hidden = false;
        el.commsAnswer1.className = 'cp-comms-answer cp-comms-answer--yes';
        el.commsAnswer1.textContent = 'Sí — hay ' + items.length + ' comunicaciones' + (mandatoryCount ? ', ' + mandatoryCount + ' obligatorias' : '') + '.';
      }
    }

    // RGPD countdown
    if (el.commsUrgencyAlert) {
      var rgpd = null;
      for (var rr = 0; rr < items.length; rr++) {
        if (items[rr].plazo_horas === 72 && onset) { rgpd = items[rr]; break; }
      }
      if (rgpd && onset) {
        var limitMs = onset.getTime() + (72 * 3600000);
        var remMs = limitMs - clock.now();
        el.commsUrgencyAlert.hidden = false;
        if (remMs > 0) {
          var remH = Math.floor(remMs / 3600000);
          var remM = Math.floor((remMs % 3600000) / 60000);
          el.commsUrgencyAlert.className = remH < 12
            ? 'cp-comms-urgency-alert cp-comms-urgency-alert--danger'
            : 'cp-comms-urgency-alert cp-comms-urgency-alert--warn';
          el.commsUrgencyAlert.innerHTML = '<strong>⏳ RGPD 72 h:</strong> Quedan <strong>' + remH + ' h ' + remM + ' min</strong> para notificar a la AEPD si aplica.';
        } else {
          el.commsUrgencyAlert.className = 'cp-comms-urgency-alert cp-comms-urgency-alert--critical';
          el.commsUrgencyAlert.innerHTML = '<strong>⛔ Plazo RGPD vencido.</strong> Documenta el motivo del retraso.';
        }
      } else {
        el.commsUrgencyAlert.hidden = true;
      }
    }

    if (!items.length) {
      if (el.commsEmpty) { el.commsEmpty.hidden = false; el.commsEmpty.textContent = 'Sin comunicaciones para este contexto.'; }
      if (el.commsTimelineWrap) { el.commsTimelineWrap.hidden = true; }
      return;
    }
    if (el.commsEmpty) { el.commsEmpty.hidden = true; }
    if (el.commsTimelineWrap) { el.commsTimelineWrap.hidden = false; }

    // Build horizontal timeline — preguntas 2 y 3
    var html = '';
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var tone = commsToneClass(item.color);
      var status = getCommsStatus(item, elapsedMin);
      var isActive = item.id === commsState.activeItemId;
      var isMandatory = item.mandatory;

      html +=
        '<div class="cp-comms-node cp-comms-node--' + tone + (isActive ? ' is-active' : '') + '" ' +
          'role="listitem" data-comms-id="' + esc(item.id) + '" tabindex="0" ' +
          'aria-label="' + esc(item.title) + '">' +
          '<div class="cp-comms-node__when">' + esc(item.when) + '</div>' +
          '<div class="cp-comms-node__dot' + (isMandatory ? ' cp-comms-node__dot--mandatory' : '') + '"></div>' +
          '<div class="cp-comms-node__title">' + esc(item.title) + '</div>' +
          (status.key === 'overdue'
            ? '<div class="cp-comms-node__badge cp-comms-node__badge--overdue">' + esc(status.label) + '</div>'
            : status.key === 'due' && item.plazo_horas
            ? '<div class="cp-comms-node__badge cp-comms-node__badge--due">' + esc(status.label) + '</div>'
            : '') +
        '</div>';
    }
    el.commsTimeline.innerHTML = html;

    // Wire click → open ficha
    var nodes = el.commsTimeline.querySelectorAll('[data-comms-id]');
    for (var n = 0; n < nodes.length; n++) {
      (function(node) {
        var handler = function() {
          var id = node.getAttribute('data-comms-id');
          var found = null;
          for (var k = 0; k < COMMS_TABLE.length; k++) {
            if (COMMS_TABLE[k].id === id) { found = COMMS_TABLE[k]; break; }
          }
          if (!found) { return; }
          // Deactivate all
          var all = el.commsTimeline.querySelectorAll('.cp-comms-node');
          for (var a = 0; a < all.length; a++) { all[a].classList.remove('is-active'); }
          node.classList.add('is-active');
          // Open ficha
          if (el.commsFichaWrap) { el.commsFichaWrap.hidden = false; }
          if (el.commsFichaToggle) {
            el.commsFichaToggle.setAttribute('aria-expanded', 'true');
            el.commsFichaToggle.querySelector('.cp-comms-ficha-toggle__arrow').textContent = '▾';
            var label = el.commsFichaToggle.querySelector('span:first-child');
            if (label) { label.textContent = found.title; }
          }
          if (el.commsFicha) { el.commsFicha.hidden = false; }
          renderCommsFicha(found, elapsedMin);
          // Scroll ficha into view
          if (el.commsFichaWrap) {
            setTimeout(function() { el.commsFichaWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 80);
          }
        };
        node.addEventListener('click', handler);
        node.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      })(nodes[n]);
    }

    // Auto-select first item if none active
    if (!commsState.activeItemId && items.length) {
      commsState.activeItemId = null;
    }
  }

    if (el.activateBtn) {
    el.activateBtn.addEventListener('click', activateRoom);
  }
  if (el.fichaBtn) {
    el.fichaBtn.addEventListener('click', generarFicha);
  }
  if (el.containBtn) {
    el.containBtn.addEventListener('click', function () {
      state.pausedElapsed = getElapsed();
      stopLiveClock();
      updateStatus('contain', 'contained_by_user');
    });
  }
  if (el.resumeBtn) {
    el.resumeBtn.addEventListener('click', function () {
      updateStatus('resume', 'resumed_by_user');
    });
  }
  if (el.closeBtn) {
    el.closeBtn.addEventListener('click', function () {
      state.pausedElapsed = getElapsed();
      stopLiveClock();
      updateStatus('close', 'closed_by_user');
    });
  }
  for (var t = 0; t < el.tabs.length; t++) {
    el.tabs[t].addEventListener('click', function () {
      if (this.disabled) { return; }
      switchTab(this.getAttribute('data-tab'));
    });
  }
  if (el.analyzeBtn) {
    el.analyzeBtn.addEventListener('click', function () {
      if (this.disabled || state.actionLock) { return; }
      this.classList.add('is-scanning');
      var btn = this;
      setStatusText('Escaneando servicios y tolerancias…');
      setTimeout(function () {
        btn.classList.remove('is-scanning');
        // trigger full impact computation and switch tab
        computeAffectedServices();
        renderMode2();
        renderCommittee();
        startLiveClock();
        switchTab('impact');
        setStatusText('Impact Scan completado · ' + state.affectedServices.length + ' servicios analizados');
      }, 1100);
    });
  }
  if (el.svcBackdrop) {
    el.svcBackdrop.addEventListener('click', closeSvcOverlay);
  }
  if (el.svcClose) {
    el.svcClose.addEventListener('click', closeSvcOverlay);
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && el.svcOverlay && !el.svcOverlay.hidden) {
      closeSvcOverlay();
    }
  });
  root.addEventListener('click', function (evt) {
    var target = evt.target;
    var assetLink = target && target.closest ? target.closest('[data-asset-id]') : null;
    if (assetLink) {
      var assetId = assetLink.getAttribute('data-asset-id') || '';
      if (assetId) {
        evt.preventDefault();
        evt.stopPropagation();
        openAssetInEmas(assetId);
        return;
      }
    }
    var navBtn = target && target.closest ? target.closest('[data-go-tab]') : null;
    if (navBtn) {
      var tabName = navBtn.getAttribute('data-go-tab') || '';
      if (tabName) {
        evt.preventDefault();
        switchTab(tabName);
      }
    }
  }, true);

  if (el.historyWrap) {
    el.historyWrap.addEventListener('click', function (evt) {
      var target = evt.target;
      var btn = target && target.closest ? target.closest('.cp-history-close-btn') : null;
      if (!btn || state.actionLock) { return; }
      var targetId = parseInt(btn.getAttribute('data-id') || '0', 10);
      if (!targetId) { return; }
      if (!window.confirm('¿Cerrar esta activación? Esta acción no se puede deshacer.')) { return; }
      updateStatus('close', 'manual_history_close', targetId);
    });
  }
  if (el.historyExportBtn) {
    el.historyExportBtn.addEventListener('click', exportHistoryCsv);
  }
  if (el.commandCenter) {
    el.commandCenter.addEventListener('click', function (evt) {
      var target = evt.target;
      var btn = target && target.closest ? target.closest('[data-copy-email]') : null;
      if (!btn) { return; }
      var emails = btn.getAttribute('data-copy-email') || '';
      if (!emails) { return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(emails).then(function () {
          setViewNotice('Destinatarios copiados al portapapeles.', 'info');
        }).catch(function () {
          setViewNotice('No se ha podido copiar automáticamente. Copia los destinatarios manualmente.', 'warn');
        });
      } else {
        setViewNotice('Tu navegador no permite copia automática. Copia los destinatarios manualmente.', 'warn');
      }
    });
  }

  setTabAvailability(false);
  if (!impactOnly) {
    renderScenarios();
    updatePattern();
    renderHistory();
    renderLevel();
  }

  // Help modal for level tab
  var levelHelpBtn = document.getElementById('cp-level-help-btn');
  var levelModal = document.getElementById('cp-level-modal');
  if (levelHelpBtn && levelModal) {
    levelHelpBtn.addEventListener('click', function() { levelModal.style.display = 'flex'; });
    var levelModalClose = document.getElementById('cp-level-modal-close');
    if (levelModalClose) { levelModalClose.addEventListener('click', function() { levelModal.style.display = 'none'; }); }
    levelModal.addEventListener('click', function(e) { if (e.target === levelModal) { levelModal.style.display = 'none'; } });
  }

  // ── Onset field event listeners ──────────────────────────────────────────
  if (el.onsetInput) {
    el.onsetInput.addEventListener('input', function() { el.onsetInput._userEditing = true; });
    el.onsetInput.addEventListener('focus', function() { el.onsetInput._userEditing = true; });
  }
  if (el.onsetApplyBtn) {
    el.onsetApplyBtn.addEventListener('click', applyOnset);
  }

  // ── Comms context selector (3 buttons E3/E5/E6) ──────────────────────────
  if (el.commsCtxGroup) {
    el.commsCtxGroup.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-ctx]') : null;
      if (!btn) { return; }
      var ctx = btn.getAttribute('data-ctx');
      commsState.ctx = ctx;
      commsState.activeItemId = null;
      // Update aria + class
      var btns = el.commsCtxGroup.querySelectorAll('[data-ctx]');
      for (var b = 0; b < btns.length; b++) {
        btns[b].classList.toggle('is-active', btns[b].getAttribute('data-ctx') === ctx);
        btns[b].setAttribute('aria-pressed', btns[b].getAttribute('data-ctx') === ctx ? 'true' : 'false');
      }
      // Reset ficha
      if (el.commsFichaWrap) { el.commsFichaWrap.hidden = true; }
      if (el.commsFicha) { el.commsFicha.hidden = true; el.commsFicha.innerHTML = ''; }
      if (el.commsFichaToggle) {
        el.commsFichaToggle.setAttribute('aria-expanded', 'false');
        var arrow = el.commsFichaToggle.querySelector('.cp-comms-ficha-toggle__arrow');
        if (arrow) { arrow.textContent = '▸'; }
        var lbl = el.commsFichaToggle.querySelector('span:first-child');
        if (lbl) { lbl.textContent = 'Ver ficha operativa del hito seleccionado'; }
      }
      renderComms();
    });
  }

  // ── Ficha toggle ──────────────────────────────────────────────────────────
  if (el.commsFichaToggle) {
    el.commsFichaToggle.addEventListener('click', function() {
      if (!el.commsFicha) { return; }
      var isOpen = !el.commsFicha.hidden;
      el.commsFicha.hidden = isOpen;
      el.commsFichaToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      var arrow = el.commsFichaToggle.querySelector('.cp-comms-ficha-toggle__arrow');
      if (arrow) { arrow.textContent = isOpen ? '▸' : '▾'; }
    });
  }

  // ── Tab switch hook: render comms when opening the tab ───────────────────
  for (var tc = 0; tc < el.tabs.length; tc++) {
    (function(tab) {
      tab.addEventListener('click', function() {
        if (tab.getAttribute('data-tab') === 'comunicaciones') {
          setTimeout(renderComms, 0);
        }
      });
    })(el.tabs[tc]);
  }

  applyImpactOnlyMode();
  if (!impactOnly) {
    setFichaLockState(false);
    updateActionButtons();
    updateOnsetUI();
    renderComms();
  }
  if (!impactOnly) {
    renderScenarios();
    updatePattern();
    renderHistory();
    renderLevel();
  }
  loadContext();
}
