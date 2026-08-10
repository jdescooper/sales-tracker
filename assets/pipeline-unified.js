(function () {
  if (window.__CIS_UNIFIED_PIPELINE__) return;
  window.__CIS_UNIFIED_PIPELINE__ = true;

  const STORAGE_KEY = "cis-lead-crm-v3";
  const STAGE_BENCHMARK_DAYS = {
    intake_measure_prep: 3,
    measure_management: 3,
    quote_customer_decision: 8,
    sold_payment_gate: 3,
    install_closeout: 14,
    lost_cancelled: 0
  };
  const FINE_POINTER = window.matchMedia("(pointer: fine)");
  let scheduled = false;
  let rendering = false;

  injectStyles();
  patchStorage();
  scheduleRender();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender, { once: true });
  }

  const observer = new MutationObserver(() => {
    if (!rendering) scheduleRender();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("input", (event) => {
    if (isPipelineControl(event.target)) scheduleRender();
  });
  document.addEventListener("change", (event) => {
    if (isPipelineControl(event.target)) scheduleRender();
  });

  function patchStorage() {
    if (window.__CIS_UNIFIED_STORAGE_PATCHED__) return;
    window.__CIS_UNIFIED_STORAGE_PATCHED__ = true;
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = function setItem(key, value) {
      const result = originalSetItem(key, value);
      if (key === STORAGE_KEY) scheduleRender();
      return result;
    };
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      renderUnifiedPipeline();
    });
  }

  function renderUnifiedPipeline() {
    const reporting = window.CISReporting;
    const board = document.getElementById("board-view");
    if (!reporting || !board) return;

    rendering = true;
    try {
      removePhaseTabs();
      const stages = reporting.PIPELINE_STAGES || [];
      const leads = getFilteredLeads(reporting);
      const groups = stages.map((stage) => ({
        stage,
        leads: leads.filter((lead) => lead.stageId === stage.id)
      }));
      const count = groups.reduce((sum, group) => sum + group.leads.length, 0);
      const mobileStageId = hydrateMobileStageFilter(stages);
      const mobileGroups = mobileStageId === "all"
        ? groups
        : groups.filter((group) => group.stage.id === mobileStageId);

      const boardCount = document.getElementById("board-count");
      if (boardCount) boardCount.textContent = `${count} ${count === 1 ? "lead" : "leads"} across all stages`;

      board.innerHTML = `
        <div class="board-scroller" tabindex="0" aria-describedby="board-scroll-hint">
          <div class="stage-board">
            ${groups.map((group) => renderStageColumn(reporting, group.stage, group.leads)).join("")}
          </div>
        </div>
        <div class="mobile-stage-list">
          ${mobileGroups.map((group) => renderMobileStageGroup(reporting, group.stage, group.leads)).join("")}
        </div>
      `;
    } finally {
      window.setTimeout(() => {
        rendering = false;
      }, 0);
    }
  }

  function removePhaseTabs() {
    const removeTargets = new Set();
    document.querySelectorAll(".phase-tabs, [data-phase-tab]").forEach((element) => {
      removeTargets.add(element.closest(".phase-tabs") || element);
    });
    removeTargets.forEach((element) => element.remove());
  }

  function hydrateMobileStageFilter(stages) {
    const select = document.getElementById("mobile-stage-filter");
    if (!select) return "all";
    const previous = select.value || "all";
    select.innerHTML = [
      '<option value="all">All stages</option>',
      ...stages.map((stage) => `<option value="${escapeHtml(stage.id)}">${escapeHtml(stage.name)}</option>`)
    ].join("");
    select.value = stages.some((stage) => stage.id === previous) ? previous : "all";
    return select.value;
  }

  function getFilteredLeads(reporting) {
    const payload = readStorage();
    const leads = Array.isArray(payload.leads)
      ? payload.leads.map((lead) => reporting.normalizeLead(lead))
      : [];
    const filters = {
      search: valueOf("search-filter"),
      rep: valueOf("rep-filter") || "all",
      stage: valueOf("stage-filter") || "all",
      start: valueOf("start-filter"),
      end: valueOf("end-filter")
    };
    return reporting.filterLeads(leads, filters);
  }

  function readStorage() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function renderStageColumn(reporting, stage, leads) {
    const revenue = leads.reduce((sum, lead) => sum + Number(lead.quoteAmount || 0), 0);
    return `
      <section class="stage-column" data-stage-drop="${escapeHtml(stage.id)}" aria-label="${escapeHtml(stage.name)}">
        <div class="stage-heading">
          <div>
            <h3>${escapeHtml(stage.shortName || stage.name)}</h3>
            <p>${leads.length} ${leads.length === 1 ? "lead" : "leads"}</p>
          </div>
          <strong>${reporting.formatCurrency(revenue)}</strong>
        </div>
        <div class="stage-cards">
          ${leads.length ? leads.map((lead) => renderLeadCard(reporting, lead)).join("") : renderEmpty("No leads")}
        </div>
      </section>
    `;
  }

  function renderMobileStageGroup(reporting, stage, leads) {
    return `
      <section class="mobile-stage-group">
        <div class="stage-heading">
          <div>
            <h3>${escapeHtml(stage.name)}</h3>
            <p>${leads.length} ${leads.length === 1 ? "lead" : "leads"}</p>
          </div>
        </div>
        <div class="stage-cards">
          ${leads.length ? leads.map((lead) => renderLeadCard(reporting, lead)).join("") : renderEmpty("No leads")}
        </div>
      </section>
    `;
  }

  function renderLeadCard(reporting, lead) {
    const status = reporting.nextActionStatus(lead, today());
    const warning = getWarningLabel(reporting, lead, status);
    const value = lead.quoteAmount ? reporting.formatCurrency(lead.quoteAmount) : "Not quoted";
    const age = stageAgeStatus(reporting, lead);
    const closed = reporting.isClosedLead(lead);
    const draggable = FINE_POINTER.matches && !lead.archivedAt;
    return `
      <article class="lead-card ${escapeHtml(status.status)} age-${escapeHtml(age.status)}" draggable="${draggable}" data-lead-card="${escapeHtml(lead.id)}">
        <div class="card-topline">
          <span class="lead-id">MWO ${escapeHtml(lead.externalLeadId || "not set")}</span>
          <span class="rep-pill">${escapeHtml(lead.repName)}</span>
        </div>
        <div class="received-banner">
          <span>Received</span>
          <strong>${escapeHtml(formatDisplayDate(lead.dateReceived) || "Not set")}</strong>
        </div>
        <button class="card-main" data-open-lead="${escapeHtml(lead.id)}" type="button">
          <strong>${escapeHtml(lead.customerName || "Unnamed customer")}</strong>
          <span>${escapeHtml(formatLocation(lead) || "Location TBD")}</span>
        </button>
        <dl class="card-facts">
          <div><dt>Value</dt><dd>${escapeHtml(value)}</dd></div>
          <div><dt>Next</dt><dd>${escapeHtml(lead.nextAction || "No next action")}</dd></div>
          <div><dt>Due</dt><dd><span class="status-pill ${escapeHtml(status.status)}">${statusIcon(status.status)} ${escapeHtml(status.label)}</span></dd></div>
          <div><dt>Stage age</dt><dd><span class="age-pill ${escapeHtml(age.status)}">${escapeHtml(age.label)}</span></dd></div>
          <div><dt>Expected close</dt><dd>${escapeHtml(lead.expectedCloseDate || "-")}</dd></div>
          <div><dt>Last activity</dt><dd>${escapeHtml(formatDisplayDate(lead.lastActivityAt) || "-")}</dd></div>
        </dl>
        ${warning ? `<p class="card-warning">${escapeHtml(warning)}</p>` : ""}
        <div class="quick-actions">
          ${closed ? "" : `
            <button class="text-button" data-complete-action="${escapeHtml(lead.id)}" type="button">Done</button>
            <button class="text-button" data-schedule-action="${escapeHtml(lead.id)}" type="button">Schedule</button>
            <button class="text-button" data-move-lead="${escapeHtml(lead.id)}" type="button">Move</button>
          `}
          <details class="card-menu">
            <summary>More</summary>
            <div class="menu-panel">
              <button type="button" data-open-lead="${escapeHtml(lead.id)}">Edit</button>
              <button type="button" data-note-lead="${escapeHtml(lead.id)}">Add note</button>
              ${closed ? "" : `<button type="button" data-mark-lost="${escapeHtml(lead.id)}">Mark lost</button>`}
            </div>
          </details>
        </div>
      </article>
    `;
  }

  function stageAgeStatus(reporting, lead) {
    const days = reporting.daysInCurrentStage(lead, today());
    const benchmark = STAGE_BENCHMARK_DAYS[lead.stageId] || 0;
    if (!benchmark) return { status: "neutral", label: `${days}d in stage` };
    if (days > benchmark) return { status: "red", label: `${days}d / ${benchmark}d benchmark` };
    if (days === benchmark) return { status: "yellow", label: `${days}d / ${benchmark}d benchmark` };
    return { status: "green", label: `${days}d / ${benchmark}d benchmark` };
  }

  function getWarningLabel(reporting, lead, status) {
    const age = stageAgeStatus(reporting, lead);
    if (age.status === "red") return `Over stage benchmark: ${age.label}`;
    if (status.status === "overdue") return `Overdue next action: ${status.label}`;
    if (reporting.isAgingQuoteLead(lead, { today: today() })) return "Aging quote: open 8+ days";
    if (reporting.isStaleLead(lead, { today: today() })) return "Stale: no recent activity";
    if (reporting.isNoNextActionLead(lead)) return "Needs next action";
    return "";
  }

  function formatLocation(lead) {
    const cityStateZip = [
      lead.city,
      [lead.state, lead.zipCode].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");
    return [lead.street || lead.address, cityStateZip].filter(Boolean).join(" | ");
  }

  function formatDisplayDate(value) {
    if (!value) return "";
    const parts = String(value).slice(0, 10).split("-");
    if (parts.length !== 3) return String(value);
    const [year, month, day] = parts;
    return `${Number(month)}/${Number(day)}/${year}`;
  }

  function statusIcon(status) {
    if (status === "overdue") return "[!]";
    if (status === "today") return "[*]";
    if (status === "none") return "[-]";
    return "[ ]";
  }

  function renderEmpty(message) {
    return `<p class="empty-state">${escapeHtml(message)}</p>`;
  }

  function valueOf(id) {
    return document.getElementById(id)?.value || "";
  }

  function isPipelineControl(target) {
    return Boolean(target && [
      "search-filter",
      "rep-filter",
      "stage-filter",
      "start-filter",
      "end-filter",
      "mobile-stage-filter"
    ].includes(target.id));
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function injectStyles() {
    if (document.getElementById("pipeline-unified-styles")) return;
    const style = document.createElement("style");
    style.id = "pipeline-unified-styles";
    style.textContent = ".phase-tabs,[data-phase-tab]{display:none!important;}";
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();