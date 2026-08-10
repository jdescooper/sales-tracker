const {
  PIPELINE_STAGES,
  STAGE_BY_ID,
  STORAGE_VERSION,
  normalizeLead,
  filterLeads,
  calculateRepMetrics,
  calculateTeamMetrics,
  daysInCurrentStage,
  nextActionStatus,
  isOverdueLead,
  isDueTodayLead,
  isNoNextActionLead,
  isStaleLead,
  isAgingQuoteLead,
  isClosedLead,
  isCompletedLead,
  sortLeadsByUrgency,
  migrateLeads,
  formatCurrency,
  formatPercent,
  formatNumber,
  toCsv
} = window.CISReporting;

const STORAGE_KEY = "cis-lead-crm-v3";
const LEGACY_STORAGE_KEYS = ["cis-lead-crm-v2"];
const DEFAULT_REPS = ["Jordan Desbien", "Mary Kirkland", "Tyler Choate", "Sergio"];
const TODAY = () => new Date().toISOString().slice(0, 10);
const FINE_POINTER = window.matchMedia("(pointer: fine)");
const STAGE_BENCHMARK_DAYS = {
  intake_measure_prep: 3,
  measure_management: 3,
  quote_customer_decision: 8,
  sold_payment_gate: 3,
  install_closeout: 14,
  lost_cancelled: 0
};

const PHASES = {
  sales: {
    label: "Sales",
    stageIds: ["intake_measure_prep", "measure_management", "quote_customer_decision"],
    includes: (lead) => ["intake_measure_prep", "measure_management", "quote_customer_decision"].includes(lead.stageId)
  },
  fulfillment: {
    label: "Fulfillment",
    stageIds: ["sold_payment_gate", "install_closeout"],
    includes: (lead) => lead.stageId === "sold_payment_gate" || (lead.stageId === "install_closeout" && !lead.closedDate)
  },
  closed: {
    label: "Closed",
    stageIds: ["install_closeout", "lost_cancelled"],
    includes: (lead) => lead.stageId === "lost_cancelled" || Boolean(lead.closedDate)
  }
};

const state = {
  leads: loadLeads(),
  view: "my-work",
  phase: "sales",
  mobileStageId: "all",
  draggingLeadId: "",
  pendingStageMove: null,
  pendingQuickAction: null,
  selectedLeadId: "",
  previousFocus: null,
  formDirty: false,
  filters: {
    search: "",
    rep: "all",
    stage: "all",
    start: "",
    end: ""
  }
};

document.addEventListener("DOMContentLoaded", () => {
  hydrateStageOptions();
  bindEvents();
  hydrateLeadForm();
  render();
});

function loadLeads() {
  const current = readJsonStorage(STORAGE_KEY);
  if (current) {
    const migrated = migrateLeads(current, { fromVersion: current.version || STORAGE_VERSION });
    return migrated.leads;
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = readJsonStorage(key);
    if (legacy) {
      const migrated = migrateLeads(legacy, { fromVersion: legacy.version || 2 });
      writeStorage(migrated.leads);
      return migrated.leads;
    }
  }

  return [];
}

function readJsonStorage(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeStorage(leads) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      leads: leads.map(normalizeLead)
    }));
  } catch {
    showStatus("Unable to save in this browser session.", true);
  }
}

function saveLeads() {
  state.leads = state.leads.map(normalizeLead);
  writeStorage(state.leads);
}

function bindEvents() {
  document.getElementById("new-lead").addEventListener("click", (event) => openLeadModal(event.currentTarget));
  document.getElementById("lead-form").addEventListener("submit", saveLeadFromForm);
  document.getElementById("lead-form").addEventListener("input", markLeadFormDirty);
  document.getElementById("lead-form").addEventListener("change", markLeadFormDirty);
  document.getElementById("rep-choice").addEventListener("change", toggleNewRepField);
  document.getElementById("close-modal").addEventListener("click", () => requestCloseLeadModal());
  document.getElementById("cancel-modal").addEventListener("click", () => requestCloseLeadModal());

  document.getElementById("close-drawer").addEventListener("click", closeDrawer);
  document.getElementById("lead-drawer").addEventListener("click", (event) => {
    if (event.target.id === "lead-drawer") closeDrawer();
  });

  document.getElementById("stage-form").addEventListener("submit", confirmStageMove);
  document.getElementById("close-stage-modal").addEventListener("click", closeStageModal);
  document.getElementById("cancel-stage-modal").addEventListener("click", closeStageModal);
  document.getElementById("quick-action-form").addEventListener("submit", saveQuickAction);
  document.getElementById("close-quick-action").addEventListener("click", closeQuickAction);
  document.getElementById("cancel-quick-action").addEventListener("click", closeQuickAction);

  ["export-report", "report-export-report"].forEach((id) => document.getElementById(id).addEventListener("click", exportReportCsv));
  ["export-leads", "report-export-leads"].forEach((id) => document.getElementById(id).addEventListener("click", exportLeadsCsv));
  ["print-report", "report-print"].forEach((id) => document.getElementById(id).addEventListener("click", () => window.print()));

  document.querySelectorAll("[data-view-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.viewTab;
      render();
    });
  });

  document.querySelectorAll("[data-phase-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.phase = button.dataset.phaseTab;
      state.mobileStageId = "all";
      render();
    });
  });

  ["search-filter", "rep-filter", "stage-filter", "start-filter", "end-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateFiltersFromControls);
  });

  document.getElementById("mobile-stage-filter").addEventListener("change", (event) => {
    state.mobileStageId = event.target.value;
    renderBoard(filteredLeads());
  });

  document.body.addEventListener("click", handleDocumentClick);
  document.body.addEventListener("submit", handleDocumentSubmit);
  document.body.addEventListener("change", handleDocumentChange);
  document.body.addEventListener("dragstart", handleDragStart);
  document.body.addEventListener("dragover", handleDragOver);
  document.body.addEventListener("dragleave", handleDragLeave);
  document.body.addEventListener("drop", handleDrop);
  document.body.addEventListener("dragend", handleDragEnd);
  document.addEventListener("keydown", handleGlobalKeydown);
}

function hydrateStageOptions() {
  const stageOptions = PIPELINE_STAGES.map((stage) => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`).join("");
  document.getElementById("stage-filter").innerHTML = [
    '<option value="all">All stages</option>',
    stageOptions
  ].join("");
}

function hydrateLeadForm(lead) {
  const form = document.getElementById("lead-form");
  clearErrors(form, document.getElementById("lead-error-summary"));
  form.reset();
  form.elements.id.value = lead?.id || "";
  form.elements.externalLeadId.value = lead?.externalLeadId || "";
  form.elements.customerName.value = lead?.customerName || "";
  form.elements.contactPhone.value = lead?.contactPhone || "";
  form.elements.contactEmail.value = lead?.contactEmail || "";
  form.elements.source.value = lead?.source || "HDSC";
  form.elements.jobPath.value = lead?.jobPath || "SFI";
  form.elements.street.value = lead?.street || lead?.address || "";
  form.elements.city.value = lead?.city || "";
  form.elements.state.value = lead?.state || "";
  form.elements.zipCode.value = lead?.zipCode || "";
  form.elements.storeNumber.value = lead?.storeNumber || "";
  form.elements.productType.value = lead?.productType || "";
  form.elements.measureScheduledDate.value = lead?.measureScheduledDate || "";
  form.elements.installScheduledDate.value = lead?.installScheduledDate || "";
  form.elements.dateReceived.value = lead?.dateReceived || TODAY();
  form.elements.priority.value = lead?.priority || "normal";
  form.elements.nextAction.value = lead?.nextAction || "";
  form.elements.nextActionDue.value = lead?.nextActionDue || "";

  hydrateRepChoice(lead?.repName || "");
  state.formDirty = false;
}

function hydrateRepChoice(selectedRep) {
  const reps = getKnownReps();
  const select = document.getElementById("rep-choice");
  const knownSelected = reps.includes(selectedRep);
  select.innerHTML = [
    '<option value="">Select rep</option>',
    ...reps.map((rep) => `<option value="${escapeHtml(rep)}">${escapeHtml(rep)}</option>`),
    '<option value="__new__">Add a rep...</option>'
  ].join("");
  select.value = selectedRep && knownSelected ? selectedRep : selectedRep ? "__new__" : "";
  document.getElementById("lead-form").elements.repName.value = selectedRep && !knownSelected ? selectedRep : "";
  toggleNewRepField();
}

function getKnownReps() {
  return Array.from(new Set([
    ...DEFAULT_REPS,
    ...state.leads.map((lead) => lead.repName).filter(Boolean)
  ])).sort((a, b) => a.localeCompare(b));
}

function toggleNewRepField() {
  const select = document.getElementById("rep-choice");
  const field = document.getElementById("new-rep-field");
  field.hidden = select.value !== "__new__";
  field.querySelector("input").required = select.value === "__new__";
}

function updateFiltersFromControls() {
  state.filters.search = document.getElementById("search-filter").value;
  state.filters.rep = document.getElementById("rep-filter").value;
  state.filters.stage = document.getElementById("stage-filter").value;
  state.filters.start = document.getElementById("start-filter").value;
  state.filters.end = document.getElementById("end-filter").value;
  render();
}

function filteredLeads() {
  return filterLeads(state.leads, state.filters);
}

function render() {
  renderViewTabs();
  renderRepControls();
  const leads = filteredLeads();
  renderFocusMetrics(leads);
  renderMyWork(leads);
  renderBoard(leads);
  renderReport(leads);
}

function renderViewTabs() {
  document.querySelectorAll("[data-view-tab]").forEach((button) => {
    const isActive = button.dataset.viewTab === state.view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const isActive = panel.id === `view-${state.view}`;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
  document.querySelectorAll("[data-phase-tab]").forEach((button) => {
    const isActive = button.dataset.phaseTab === state.phase;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderRepControls() {
  const reps = getKnownReps();
  const filter = document.getElementById("rep-filter");
  const currentFilter = filter.value || state.filters.rep;
  filter.innerHTML = [
    '<option value="all">All reps</option>',
    ...reps.map((rep) => `<option value="${escapeHtml(rep)}">${escapeHtml(rep)}</option>`)
  ].join("");
  filter.value = reps.includes(currentFilter) ? currentFilter : "all";
  state.filters.rep = filter.value;
}

function renderFocusMetrics(leads) {
  const today = TODAY();
  const activeLeads = leads.filter((lead) => !isClosedLead(lead));
  const totals = calculateTeamMetrics(activeLeads, { today });
  const metrics = [
    ["Overdue", formatNumber(totals.overdueActions), "Next actions past due"],
    ["Due today", formatNumber(totals.dueTodayActions), "Needs contact today"],
    ["No next action", formatNumber(totals.noNextAction), "Needs a plan"],
    ["Aging quotes", formatNumber(totals.agingOpenQuotes), "Quote open 8+ days"],
    ["Open potential", formatCurrency(totals.openPotentialRevenue), "Quote-stage value"]
  ];
  document.getElementById("focus-metrics").innerHTML = metrics.map(([label, value, helper]) => `
    <article class="focus-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${helper}</small>
    </article>
  `).join("");
}

function renderMyWork(leads) {
  const today = TODAY();
  const activeLeads = leads.filter((lead) => !isClosedLead(lead));
  const urgent = sortLeadsByUrgency(activeLeads, { today });
  const buckets = [
    {
      id: "overdue",
      title: "Overdue next actions",
      helper: "Work these first.",
      leads: urgent.filter((lead) => isOverdueLead(lead, today))
    },
    {
      id: "today",
      title: "Due today",
      helper: "Scheduled follow-up for today.",
      leads: urgent.filter((lead) => isDueTodayLead(lead, today))
    },
    {
      id: "no-next",
      title: "No next action",
      helper: "Assign a specific action and due date.",
      leads: urgent.filter((lead) => isNoNextActionLead(lead))
    },
    {
      id: "stale",
      title: "Stale leads",
      helper: "No recent activity.",
      leads: urgent.filter((lead) => isStaleLead(lead, { today }))
    },
    {
      id: "aging",
      title: "Aging quotes",
      helper: "Quotes open for 8+ days.",
      leads: urgent.filter((lead) => isAgingQuoteLead(lead, { today }))
    }
  ];

  document.getElementById("work-count").textContent = `${urgent.length} active ${urgent.length === 1 ? "lead" : "leads"}`;
  document.getElementById("my-work-view").innerHTML = buckets.map((bucket) => `
    <section class="work-bucket" aria-labelledby="bucket-${bucket.id}">
      <div class="bucket-heading">
        <div>
          <h3 id="bucket-${bucket.id}">${bucket.title}</h3>
          <p>${bucket.helper}</p>
        </div>
        <strong>${bucket.leads.length}</strong>
      </div>
      <div class="bucket-list">
        ${bucket.leads.length ? bucket.leads.map((lead) => renderWorkItem(lead)).join("") : renderEmpty(`No ${bucket.title.toLowerCase()}`)}
      </div>
    </section>
  `).join("");
}

function renderWorkItem(lead) {
  const status = nextActionStatus(lead, TODAY());
  return `
    <article class="work-item">
      <button class="open-row" data-open-lead="${lead.id}" type="button">
        <span>
          <strong>${escapeHtml(lead.customerName || "Unnamed customer")}</strong>
          <small>MWO ${escapeHtml(lead.externalLeadId || "not set")} | ${escapeHtml(lead.repName)}</small>
        </span>
        <span class="status-pill ${status.status}">${statusIcon(status.status)} ${escapeHtml(status.label)}</span>
      </button>
      <div class="work-actions">
        <button class="text-button" data-complete-action="${lead.id}" type="button">Done</button>
        <button class="text-button" data-schedule-action="${lead.id}" type="button">Schedule</button>
        <button class="text-button" data-note-lead="${lead.id}" type="button">Note</button>
      </div>
    </article>
  `;
}

function renderBoard(leads) {
  const phase = PHASES[state.phase];
  const phaseLeads = leads.filter(phase.includes);
  const stageGroups = phase.stageIds.map((stageId) => ({
    stage: STAGE_BY_ID[stageId],
    leads: phaseLeads.filter((lead) => lead.stageId === stageId && (state.phase !== "closed" || stageId !== "install_closeout" || lead.closedDate))
  }));

  if (state.mobileStageId !== "all") {
    stageGroups.forEach((group) => {
      if (group.stage.id !== state.mobileStageId) group.leads = [];
    });
  }

  document.getElementById("board-count").textContent = `${phaseLeads.length} ${phaseLeads.length === 1 ? "lead" : "leads"} in ${phase.label}`;
  hydrateMobileStageFilter(stageGroups);
  document.getElementById("board-view").innerHTML = `
    <div class="board-scroller" tabindex="0" aria-describedby="board-scroll-hint">
      <div class="stage-board">
        ${stageGroups.map((group) => renderStageColumn(group.stage, group.leads)).join("")}
      </div>
    </div>
    <div class="mobile-stage-list">
      ${stageGroups.map((group) => renderMobileStageGroup(group.stage, group.leads)).join("")}
    </div>
  `;
}

function hydrateMobileStageFilter(stageGroups) {
  const select = document.getElementById("mobile-stage-filter");
  select.innerHTML = [
    '<option value="all">All stages in this phase</option>',
    ...stageGroups.map(({ stage }) => `<option value="${stage.id}">${escapeHtml(stage.name)}</option>`)
  ].join("");
  select.value = stageGroups.some((group) => group.stage.id === state.mobileStageId) ? state.mobileStageId : "all";
  state.mobileStageId = select.value;
}

function renderStageColumn(stage, leads) {
  const revenue = leads.reduce((sum, lead) => sum + Number(lead.quoteAmount || 0), 0);
  return `
    <section class="stage-column" data-stage-drop="${stage.id}" aria-label="${escapeHtml(stage.name)}">
      <div class="stage-heading">
        <div>
          <h3>${escapeHtml(stage.shortName)}</h3>
          <p>${leads.length} ${leads.length === 1 ? "lead" : "leads"}</p>
        </div>
        <strong>${formatCurrency(revenue)}</strong>
      </div>
      <div class="stage-cards">
        ${leads.length ? leads.map(renderLeadCard).join("") : renderEmpty("No leads")}
      </div>
    </section>
  `;
}

function renderMobileStageGroup(stage, leads) {
  if (state.mobileStageId !== "all" && state.mobileStageId !== stage.id) return "";
  return `
    <section class="mobile-stage-group">
      <div class="stage-heading">
        <div>
          <h3>${escapeHtml(stage.name)}</h3>
          <p>${leads.length} ${leads.length === 1 ? "lead" : "leads"}</p>
        </div>
      </div>
      <div class="stage-cards">
        ${leads.length ? leads.map(renderLeadCard).join("") : renderEmpty("No leads")}
      </div>
    </section>
  `;
}

function renderLeadCard(lead) {
  const status = nextActionStatus(lead, TODAY());
  const warning = getWarningLabel(lead, status);
  const value = lead.quoteAmount ? formatCurrency(lead.quoteAmount) : "Not quoted";
  const age = stageAgeStatus(lead);
  const location = formatLocation(lead);
  const closed = isClosedLead(lead);
  const draggable = FINE_POINTER.matches && state.phase !== "closed" && !lead.archivedAt;
  return `
    <article class="lead-card ${status.status} age-${age.status}" draggable="${draggable}" data-lead-card="${lead.id}">
      <div class="card-topline">
        <span class="lead-id">MWO ${escapeHtml(lead.externalLeadId || "not set")}</span>
        <span class="rep-pill">${escapeHtml(lead.repName)}</span>
      </div>
      <div class="received-banner">
        <span>Received</span>
        <strong>${escapeHtml(formatDisplayDate(lead.dateReceived) || "Not set")}</strong>
      </div>
      <button class="card-main" data-open-lead="${lead.id}" type="button">
        <strong>${escapeHtml(lead.customerName || "Unnamed customer")}</strong>
        <span>${escapeHtml(location || "Location TBD")}</span>
      </button>
      <dl class="card-facts">
        <div><dt>Value</dt><dd>${value}</dd></div>
        <div><dt>Next</dt><dd>${escapeHtml(lead.nextAction || "No next action")}</dd></div>
        <div><dt>Due</dt><dd><span class="status-pill ${status.status}">${statusIcon(status.status)} ${escapeHtml(status.label)}</span></dd></div>
        <div><dt>Stage age</dt><dd><span class="age-pill ${age.status}">${escapeHtml(age.label)}</span></dd></div>
        <div><dt>Expected close</dt><dd>${escapeHtml(lead.expectedCloseDate || "-")}</dd></div>
        <div><dt>Last activity</dt><dd>${escapeHtml(formatDisplayDate(lead.lastActivityAt) || "-")}</dd></div>
      </dl>
      ${warning ? `<p class="card-warning">${escapeHtml(warning)}</p>` : ""}
      <div class="quick-actions">
        ${closed ? "" : `
          <button class="text-button" data-complete-action="${lead.id}" type="button">Done</button>
          <button class="text-button" data-schedule-action="${lead.id}" type="button">Schedule</button>
          <button class="text-button" data-move-lead="${lead.id}" type="button">Move</button>
        `}
        <details class="card-menu">
          <summary>More</summary>
          <div class="menu-panel">
            <button type="button" data-open-lead="${lead.id}">Edit</button>
            <button type="button" data-note-lead="${lead.id}">Add note</button>
            ${closed ? "" : `<button type="button" data-mark-lost="${lead.id}">Mark lost</button>`}
          </div>
        </details>
      </div>
    </article>
  `;
}

function renderReport(leads) {
  const today = TODAY();
  const totals = calculateTeamMetrics(leads, { today });
  const rows = calculateRepMetrics(leads, { today });
  document.getElementById("report-view").innerHTML = `
    <div class="report-summary">
      ${renderReportMetric("Active leads", totals.leadsAssigned)}
      ${renderReportMetric("Overdue", totals.overdueActions)}
      ${renderReportMetric("Open potential", formatCurrency(totals.openPotentialRevenue))}
      ${renderReportMetric("Won revenue", formatCurrency(totals.wonRevenue))}
      ${renderReportMetric("Realized", formatCurrency(totals.realizedRevenue))}
      ${renderReportMetric("Win rate", formatPercent(totals.winRate))}
    </div>
    <div class="table-wrap" tabindex="0">
      <table>
        <thead>
          <tr>
            <th>Rep</th>
            <th>Leads</th>
            <th>Overdue</th>
            <th>Due Today</th>
            <th>No Next Action</th>
            <th>Stale</th>
            <th>Quotes</th>
            <th>Quoted $</th>
            <th>Open Potential</th>
            <th>Won Jobs</th>
            <th>Lost Jobs</th>
            <th>Win Rate</th>
            <th>Won $</th>
            <th>Realized $</th>
            <th>Avg Days to Quote</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.repName)}</td>
              <td>${formatNumber(row.leadsAssigned)}</td>
              <td>${formatNumber(row.overdueActions)}</td>
              <td>${formatNumber(row.dueTodayActions)}</td>
              <td>${formatNumber(row.noNextAction)}</td>
              <td>${formatNumber(row.staleLeads)}</td>
              <td>${formatNumber(row.quotesSent)}</td>
              <td>${formatCurrency(row.totalQuotedRevenue)}</td>
              <td>${formatCurrency(row.openPotentialRevenue)}</td>
              <td>${formatNumber(row.wonJobs)}</td>
              <td>${formatNumber(row.lostJobs)}</td>
              <td>${formatPercent(row.winRate)}</td>
              <td>${formatCurrency(row.wonRevenue)}</td>
              <td>${formatCurrency(row.realizedRevenue)}</td>
              <td>${formatNumber(row.averageDaysToQuote, 1)}</td>
            </tr>
          `).join("") : `<tr><td colspan="15">No leads match the current filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderReportMetric(label, value) {
  return `
    <article class="report-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function renderEmpty(message) {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

function handleDocumentClick(event) {
  const target = event.target;
  const openLeadButton = target.closest("[data-open-lead]");
  if (openLeadButton) {
    openDrawer(openLeadButton.dataset.openLead, openLeadButton);
    return;
  }
  const moveButton = target.closest("[data-move-lead]");
  if (moveButton) {
    openMoveChooser(moveButton.dataset.moveLead, moveButton);
    return;
  }
  const completeButton = target.closest("[data-complete-action]");
  if (completeButton) {
    completeNextAction(completeButton.dataset.completeAction);
    return;
  }
  const scheduleButton = target.closest("[data-schedule-action]");
  if (scheduleButton) {
    scheduleNextAction(scheduleButton.dataset.scheduleAction, scheduleButton);
    return;
  }
  const noteButton = target.closest("[data-note-lead]");
  if (noteButton) {
    addNote(noteButton.dataset.noteLead, noteButton);
    return;
  }
  const markLostButton = target.closest("[data-mark-lost]");
  if (markLostButton) {
    openStageTransition(markLostButton.dataset.markLost, "lost_cancelled", markLostButton);
  }
}

function handleDocumentSubmit(event) {
  if (event.target.id === "drawer-form") {
    event.preventDefault();
    saveDrawerForm(event.target);
  }
}

function handleDocumentChange(event) {
  const select = event.target.closest("[data-stage-select]");
  if (select) {
    openStageTransition(select.dataset.stageSelect, select.value, select);
    select.value = select.dataset.currentStage;
    return;
  }
  const stageChoice = event.target.closest("[data-stage-choice]");
  if (stageChoice) {
    updateStageChooser(stageChoice);
  }
}

function saveLeadFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form, document.getElementById("lead-error-summary"));

  const data = Object.fromEntries(new FormData(form).entries());
  const repName = data.repChoice === "__new__" ? data.repName : data.repChoice;
  const errors = validateLeadForm(data, repName);
  if (errors.length) {
    showErrors(form, document.getElementById("lead-error-summary"), errors);
    return;
  }

  const existing = state.leads.find((lead) => lead.id === data.id);
  const lead = normalizeLead({
    ...existing,
    ...data,
    repName,
    id: data.id || createId(),
    stageId: existing?.stageId || "intake_measure_prep",
    dateReceived: data.dateReceived,
    stageEnteredAt: existing?.stageEnteredAt || data.dateReceived || TODAY(),
    lastActivityAt: existing?.lastActivityAt || data.dateReceived || TODAY(),
    paymentStatus: existing?.paymentStatus || "Not requested"
  });

  const index = state.leads.findIndex((item) => item.id === lead.id);
  if (index >= 0) {
    recordActivity(lead, "updated", "Lead intake updated");
    state.leads[index] = lead;
  } else {
    state.leads.unshift(lead);
  }
  saveLeads();
  state.formDirty = false;
  closeLeadModal();
  showStatus("Lead saved.", false);
  render();
}

function validateLeadForm(data, repName) {
  const errors = [];
  if (!data.externalLeadId?.trim()) errors.push({ field: "externalLeadId", message: "Measure Work Order Number is required." });
  if (!data.customerName?.trim()) errors.push({ field: "customerName", message: "Customer is required." });
  if (!data.repChoice) errors.push({ field: "repChoice", message: "Assigned rep is required." });
  if (data.repChoice === "__new__" && !repName?.trim()) errors.push({ field: "repName", message: "Enter the new rep name." });
  if (!data.dateReceived) errors.push({ field: "dateReceived", message: "Received date is required." });
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) errors.push({ field: "contactEmail", message: "Enter a valid email address." });
  return errors;
}

function openLeadModal(trigger, lead) {
  state.previousFocus = trigger || document.activeElement;
  hydrateLeadForm(lead);
  document.getElementById("lead-form-title").textContent = lead ? "Edit lead intake" : "New lead";
  openLayer(document.getElementById("lead-modal"));
  window.setTimeout(() => document.querySelector('#lead-form [name="externalLeadId"]')?.focus(), 0);
}

function requestCloseLeadModal() {
  if (state.formDirty && !window.confirm("Discard unsaved lead changes?")) return;
  closeLeadModal();
}

function closeLeadModal() {
  closeLayer(document.getElementById("lead-modal"));
  state.formDirty = false;
}

function markLeadFormDirty() {
  state.formDirty = true;
}

function openDrawer(leadId, trigger) {
  const lead = findLead(leadId);
  if (!lead) return;
  state.selectedLeadId = leadId;
  state.previousFocus = trigger || document.activeElement;
  document.getElementById("drawer-title").textContent = lead.customerName || "Lead details";
  document.getElementById("drawer-content").innerHTML = renderDrawerContent(lead);
  openLayer(document.getElementById("lead-drawer"));
  window.setTimeout(() => document.querySelector("#lead-drawer input, #lead-drawer button")?.focus(), 0);
}

function renderDrawerContent(lead) {
  const stage = STAGE_BY_ID[lead.stageId];
  return `
    <div class="drawer-summary">
      <div>
        <p class="eyebrow">Measure work order</p>
        <strong>${escapeHtml(lead.externalLeadId || "Not set")}</strong>
      </div>
      <div>
        <p class="eyebrow">Received</p>
        <strong>${escapeHtml(formatDisplayDate(lead.dateReceived) || "Not set")}</strong>
      </div>
      <div>
        <p class="eyebrow">Current stage</p>
        <strong>${escapeHtml(stage.name)}</strong>
      </div>
      <div>
        <p class="eyebrow">Value</p>
        <strong>${lead.quoteAmount ? formatCurrency(lead.quoteAmount) : "Not quoted"}</strong>
      </div>
      <div>
        <p class="eyebrow">Next action</p>
        <strong>${escapeHtml(lead.nextAction || "No next action")}</strong>
      </div>
    </div>
    <form id="drawer-form" class="drawer-form">
      <input type="hidden" name="id" value="${escapeHtml(lead.id)}">
      <div class="form-section">
        <h3>Contact and action</h3>
        <div class="form-row">
          ${inputField("Phone number", "contactPhone", lead.contactPhone)}
          ${inputField("Email address", "contactEmail", lead.contactEmail, "email")}
        </div>
        <div class="form-row">
          ${inputField("Next action", "nextAction", lead.nextAction)}
          ${inputField("Next action due", "nextActionDue", lead.nextActionDue, "date")}
        </div>
        <div class="form-row">
          ${inputField("Last activity", "lastActivityAt", lead.lastActivityAt, "date")}
          ${inputField("Expected close", "expectedCloseDate", lead.expectedCloseDate, "date")}
        </div>
      </div>
      <div class="form-section">
        <h3>Job location</h3>
        ${inputField("Street", "street", lead.street)}
        <div class="form-row three">
          ${inputField("City", "city", lead.city)}
          ${inputField("State", "state", lead.state)}
          ${inputField("ZIP code", "zipCode", lead.zipCode)}
        </div>
      </div>
      <div class="form-section">
        <h3>Lifecycle fields</h3>
        <div class="form-row">
          ${inputField("Measure scheduled", "measureScheduledDate", lead.measureScheduledDate, "date")}
          ${inputField("Measure completed", "measureCompletedDate", lead.measureCompletedDate, "date")}
        </div>
        <div class="form-row">
          ${inputField("Quote amount", "quoteAmount", lead.quoteAmount || "", "number")}
          ${inputField("Quote sent", "quoteSentDate", lead.quoteSentDate, "date")}
        </div>
        <div class="form-row">
          ${inputField("Won/accepted date", "soldDate", lead.soldDate, "date")}
          ${selectField("Payment status", "paymentStatus", lead.paymentStatus, ["Not requested", "Pending", "Deposit received", "Paid", "Blocked"])}
        </div>
        <div class="form-row">
          ${inputField("Install scheduled", "installScheduledDate", lead.installScheduledDate, "date")}
          ${inputField("Closed date", "closedDate", lead.closedDate, "date")}
        </div>
        <div class="form-row">
          ${inputField("Final realized revenue", "realizedRevenue", lead.realizedRevenue || "", "number")}
          ${inputField("Lost date", "lostDate", lead.lostDate, "date")}
        </div>
        ${selectField("Lost reason", "lostReason", lead.lostReason, ["", "No Contact Made", "No Longer Interested", "Out of Scope", "Price", "Cancelled", "Duplicate"])}
      </div>
      <label>
        <span>Notes</span>
        <textarea name="notes" rows="5">${escapeHtml(lead.notes)}</textarea>
      </label>
      <div class="form-section">
        <h3>Activity trail</h3>
        ${renderActivityTrail(lead)}
      </div>
      <div class="drawer-actions sticky-actions">
        <button class="button primary" type="submit">Save Changes</button>
        <button class="button secondary" data-move-lead="${lead.id}" type="button">Move Stage</button>
        <button class="button secondary" data-mark-lost="${lead.id}" type="button">Mark Lost</button>
      </div>
    </form>
  `;
}

function inputField(label, name, value, type = "text") {
  const step = type === "number" ? ' min="0" step="0.01"' : "";
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeHtml(value)}"${step}>
    </label>
  `;
}

function selectField(label, name, value, options) {
  return `
    <label>
      <span>${label}</span>
      <select name="${name}">
        ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "None")}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderActivityTrail(lead) {
  const entries = (lead.activityLog || []).slice(0, 12);
  if (!entries.length) return renderEmpty("No activity yet");
  return `
    <ol class="activity-list">
      ${entries.map((entry) => `
        <li>
          <time>${escapeHtml(formatDisplayDate(entry.at) || entry.at || "Unknown date")}</time>
          <span>${escapeHtml(entry.label || "Activity recorded")}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

function recordActivity(lead, type, label, at = TODAY()) {
  const activity = {
    at,
    type,
    label
  };
  lead.activityLog = [activity, ...(lead.activityLog || [])].slice(0, 100);
  lead.lastActivityAt = at;
}

function saveDrawerForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const lead = findLead(data.id);
  if (!lead) return;
  Object.assign(lead, normalizeLead({
    ...lead,
    ...data,
    quoteAmount: data.quoteAmount,
    realizedRevenue: data.realizedRevenue,
    lastActivityAt: data.lastActivityAt || TODAY()
  }));
  recordActivity(lead, "updated", "Lead details updated", data.lastActivityAt || TODAY());
  saveLeads();
  showStatus("Lead details saved.", false);
  render();
  openDrawer(lead.id);
}

function openMoveChooser(leadId, trigger) {
  const lead = findLead(leadId);
  if (!lead) return;
  state.pendingStageMove = { leadId, targetStageId: "" };
  state.previousFocus = trigger || document.activeElement;
  const form = document.getElementById("stage-form");
  clearErrors(form, document.getElementById("stage-error-summary"));
  form.reset();
  form.elements.leadId.value = leadId;
  form.elements.targetStageId.value = "";
  document.getElementById("stage-modal-title").textContent = `Move ${lead.customerName || "lead"}`;
  document.getElementById("stage-form-fields").innerHTML = renderStageChooserFields(lead);
  openLayer(document.getElementById("stage-modal"));
  window.setTimeout(() => document.querySelector("[data-stage-choice]")?.focus(), 0);
}

function openStageTransition(leadId, targetStageId, trigger) {
  const lead = findLead(leadId);
  const stage = STAGE_BY_ID[targetStageId];
  if (!lead || !stage) return;
  state.pendingStageMove = { leadId, targetStageId };
  state.previousFocus = trigger || document.activeElement;
  const form = document.getElementById("stage-form");
  clearErrors(form, document.getElementById("stage-error-summary"));
  form.reset();
  form.elements.leadId.value = leadId;
  form.elements.targetStageId.value = targetStageId;
  document.getElementById("stage-modal-title").textContent = `Move to ${stage.name}`;
  document.getElementById("stage-form-fields").innerHTML = renderStageGateFields(lead, targetStageId);
  openLayer(document.getElementById("stage-modal"));
  window.setTimeout(() => document.querySelector("#stage-form input, #stage-form select, #stage-form textarea")?.focus(), 0);
}

function renderStageChooserFields(lead) {
  const stageOptions = PIPELINE_STAGES.map((stage) => `
    <option value="${stage.id}" ${stage.id === lead.stageId ? "disabled" : ""}>
      ${escapeHtml(stage.name)}${stage.id === lead.stageId ? " (current)" : ""}
    </option>
  `).join("");
  return `
    <label>
      <span>Move to stage</span>
      <select name="targetStageChoice" data-stage-choice="${escapeHtml(lead.id)}" required>
        <option value="">Select a stage</option>
        ${stageOptions}
      </select>
      <small class="field-error" data-error-for="targetStageChoice"></small>
    </label>
    <div id="stage-gate-fields">
      <p class="form-note">Select a stage to see the required fields for that move.</p>
    </div>
  `;
}

function updateStageChooser(select) {
  const lead = findLead(select.dataset.stageChoice);
  if (!lead) return;
  const form = document.getElementById("stage-form");
  const targetStageId = select.value;
  form.elements.targetStageId.value = targetStageId;
  state.pendingStageMove = { leadId: lead.id, targetStageId };
  document.getElementById("stage-gate-fields").innerHTML = targetStageId
    ? renderStageGateFields(lead, targetStageId)
    : '<p class="form-note">Select a stage to see the required fields for that move.</p>';
}

function renderStageGateFields(lead, targetStageId) {
  if (targetStageId === "quote_customer_decision") {
    return `
      ${renderRequirementList(["Quote amount entered", "Quote sent date entered"])}
      <div class="form-row">
        ${inputField("Quote amount", "quoteAmount", lead.quoteAmount || "", "number")}
        ${inputField("Quote sent date", "quoteSentDate", lead.quoteSentDate || TODAY(), "date")}
      </div>
    `;
  }
  if (targetStageId === "sold_payment_gate") {
    return `
      ${renderRequirementList(["Quote amount entered", "Quote sent date entered", "Customer accepted the quote", "Won/accepted date entered", "Payment status selected"])}
      <div class="form-row">
        ${inputField("Quote amount", "quoteAmount", lead.quoteAmount || "", "number")}
        ${inputField("Quote sent date", "quoteSentDate", lead.quoteSentDate || TODAY(), "date")}
      </div>
      <div class="form-row">
        ${inputField("Won/accepted date", "soldDate", lead.soldDate || TODAY(), "date")}
        ${selectField("Payment status", "paymentStatus", lead.paymentStatus, ["Pending", "Deposit received", "Paid", "Blocked"])}
      </div>
    `;
  }
  if (targetStageId === "install_closeout") {
    return `
      ${renderRequirementList(["Quote amount entered", "Quote sent date entered", "Won/accepted date entered", "Install scheduled date entered", "Payment status reviewed", "Closed date only when close-out is complete"])}
      <div class="form-row">
        ${inputField("Quote amount", "quoteAmount", lead.quoteAmount || "", "number")}
        ${inputField("Quote sent date", "quoteSentDate", lead.quoteSentDate || TODAY(), "date")}
      </div>
      <div class="form-row">
        ${inputField("Won/accepted date", "soldDate", lead.soldDate || TODAY(), "date")}
        ${selectField("Payment status", "paymentStatus", lead.paymentStatus, ["Pending", "Deposit received", "Paid", "Blocked"])}
      </div>
      <div class="form-row">
        ${inputField("Install scheduled date", "installScheduledDate", lead.installScheduledDate, "date")}
        ${inputField("Closed date", "closedDate", lead.closedDate, "date")}
      </div>
      <div class="form-row">
        ${inputField("Final realized revenue", "realizedRevenue", lead.realizedRevenue || "", "number")}
      </div>
    `;
  }
  if (targetStageId === "lost_cancelled") {
    return `
      ${renderRequirementList(["Lost reason selected", "Lost date entered", "Optional note added for context"])}
      <div class="form-row">
        ${selectField("Lost reason", "lostReason", lead.lostReason, ["", "No Contact Made", "No Longer Interested", "Out of Scope", "Price", "Cancelled", "Duplicate"])}
        ${inputField("Lost date", "lostDate", lead.lostDate || TODAY(), "date")}
      </div>
      <label>
        <span>Optional note</span>
        <textarea name="transitionNote" rows="3"></textarea>
      </label>
    `;
  }
  if (targetStageId === "measure_management") {
    return `
      ${renderRequirementList(["Measure appointment scheduled", "Measure scheduled date entered"])}
      ${inputField("Measure scheduled date", "measureScheduledDate", lead.measureScheduledDate, "date")}
    `;
  }
  return `${renderRequirementList(["Measure Work Order Number, customer, assigned rep, and received date verified"])}`;
}

function renderRequirementList(items) {
  return `
    <div class="requirements-box">
      <strong>Required to move here</strong>
      <ul class="requirement-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function confirmStageMove(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form, document.getElementById("stage-error-summary"));
  const data = Object.fromEntries(new FormData(form).entries());
  const lead = findLead(data.leadId);
  const targetStageId = data.targetStageId || data.targetStageChoice;
  const errors = validateStageGate(targetStageId, data);
  if (errors.length) {
    showErrors(form, document.getElementById("stage-error-summary"), errors);
    return;
  }
  const previousStageName = STAGE_BY_ID[lead.stageId].name;
  const nextStageName = STAGE_BY_ID[targetStageId].name;
  Object.assign(lead, normalizeLead({
    ...lead,
    ...data,
    stageId: targetStageId,
    stageEnteredAt: lead.stageId === targetStageId ? lead.stageEnteredAt : TODAY(),
    lastActivityAt: TODAY(),
    notes: data.transitionNote ? [lead.notes, data.transitionNote].filter(Boolean).join("\n") : lead.notes,
    soldDate: targetStageId === "lost_cancelled" ? "" : data.soldDate || lead.soldDate,
    closedDate: targetStageId === "lost_cancelled" ? "" : data.closedDate || lead.closedDate,
    realizedRevenue: targetStageId === "lost_cancelled" ? 0 : data.realizedRevenue || lead.realizedRevenue,
    nextAction: targetStageId === "lost_cancelled" ? "" : lead.nextAction,
    nextActionDue: targetStageId === "lost_cancelled" ? "" : lead.nextActionDue
  }));
  recordActivity(
    lead,
    "stage",
    targetStageId === "lost_cancelled"
      ? `Marked lost: ${data.lostReason}`
      : `Moved from ${previousStageName} to ${nextStageName}`
  );
  saveLeads();
  closeStageModal();
  showStatus(`Moved to ${STAGE_BY_ID[targetStageId].name}.`, false);
  render();
  if (!document.getElementById("lead-drawer").hidden) openDrawer(lead.id);
}

function validateStageGate(targetStageId, data) {
  const errors = [];
  if (!targetStageId) {
    errors.push({ field: "targetStageChoice", message: "Select the stage to move this lead into." });
    return errors;
  }
  if (targetStageId === "quote_customer_decision") {
    if (!Number(data.quoteAmount)) errors.push({ field: "quoteAmount", message: "Quote amount is required." });
    if (!data.quoteSentDate) errors.push({ field: "quoteSentDate", message: "Quote sent date is required." });
  }
  if (targetStageId === "measure_management") {
    if (!data.measureScheduledDate) errors.push({ field: "measureScheduledDate", message: "Measure scheduled date is required." });
  }
  if (targetStageId === "sold_payment_gate") {
    if (!Number(data.quoteAmount)) errors.push({ field: "quoteAmount", message: "Quote amount is required." });
    if (!data.quoteSentDate) errors.push({ field: "quoteSentDate", message: "Quote sent date is required." });
    if (!data.soldDate) errors.push({ field: "soldDate", message: "Won/accepted date is required." });
    if (!data.paymentStatus) errors.push({ field: "paymentStatus", message: "Payment status is required." });
  }
  if (targetStageId === "install_closeout") {
    if (!Number(data.quoteAmount)) errors.push({ field: "quoteAmount", message: "Quote amount is required." });
    if (!data.quoteSentDate) errors.push({ field: "quoteSentDate", message: "Quote sent date is required." });
    if (!data.soldDate) errors.push({ field: "soldDate", message: "Won/accepted date is required." });
    if (!data.installScheduledDate) errors.push({ field: "installScheduledDate", message: "Install scheduled date is required." });
    if (!data.paymentStatus) errors.push({ field: "paymentStatus", message: "Payment status is required." });
  }
  if (targetStageId === "lost_cancelled") {
    if (!data.lostReason) errors.push({ field: "lostReason", message: "Lost reason is required." });
    if (!data.lostDate) errors.push({ field: "lostDate", message: "Lost date is required." });
  }
  return errors;
}

function closeStageModal() {
  closeLayer(document.getElementById("stage-modal"));
  state.pendingStageMove = null;
}

function closeDrawer() {
  closeLayer(document.getElementById("lead-drawer"));
  state.selectedLeadId = "";
}

function completeNextAction(id) {
  const lead = findLead(id);
  if (!lead) return;
  const completedAction = lead.nextAction || "Next action";
  lead.nextAction = "";
  lead.nextActionDue = "";
  recordActivity(lead, "action", `Completed: ${completedAction}`);
  saveLeads();
  showStatus("Next action marked complete.", false);
  render();
}

function scheduleNextAction(id, trigger) {
  openQuickAction("schedule", id, trigger);
}

function addNote(id, trigger) {
  openQuickAction("note", id, trigger);
}

function openQuickAction(type, id, trigger) {
  const lead = findLead(id);
  if (!lead) return;
  const form = document.getElementById("quick-action-form");
  clearErrors(form, document.getElementById("quick-action-error-summary"));
  form.reset();
  form.elements.leadId.value = id;
  form.elements.actionType.value = type;
  state.pendingQuickAction = { leadId: id, type };
  state.previousFocus = trigger || document.activeElement;
  document.getElementById("quick-action-title").textContent = type === "note"
    ? `Add note for ${lead.customerName || "lead"}`
    : `Schedule action for ${lead.customerName || "lead"}`;
  document.getElementById("quick-action-fields").innerHTML = renderQuickActionFields(type, lead);
  openLayer(document.getElementById("quick-action-modal"));
  window.setTimeout(() => document.querySelector("#quick-action-form input:not([type='hidden']), #quick-action-form textarea")?.focus(), 0);
}

function renderQuickActionFields(type, lead) {
  if (type === "note") {
    return `
      <label>
        <span>Note</span>
        <textarea name="note" rows="4" required></textarea>
        <small class="field-error" data-error-for="note"></small>
      </label>
    `;
  }
  return `
    <div class="form-row">
      <label>
        <span>Next action</span>
        <input name="nextAction" value="${escapeHtml(lead.nextAction || "Follow up")}" required>
        <small class="field-error" data-error-for="nextAction"></small>
      </label>
      <label>
        <span>Due date</span>
        <input name="nextActionDue" type="date" value="${escapeHtml(lead.nextActionDue || TODAY())}" required>
        <small class="field-error" data-error-for="nextActionDue"></small>
      </label>
    </div>
  `;
}

function saveQuickAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form, document.getElementById("quick-action-error-summary"));
  const data = Object.fromEntries(new FormData(form).entries());
  const lead = findLead(data.leadId);
  if (!lead) return;

  const errors = validateQuickAction(data);
  if (errors.length) {
    showErrors(form, document.getElementById("quick-action-error-summary"), errors);
    return;
  }

  if (data.actionType === "note") {
    lead.notes = [lead.notes, `${TODAY()}: ${data.note.trim()}`].filter(Boolean).join("\n");
    recordActivity(lead, "note", `Note added: ${data.note.trim()}`);
    showStatus("Note added.", false);
  } else {
    lead.nextAction = data.nextAction.trim();
    lead.nextActionDue = data.nextActionDue;
    recordActivity(lead, "action", `Scheduled: ${lead.nextAction} due ${data.nextActionDue}`);
    showStatus("Next action scheduled.", false);
  }
  saveLeads();
  closeQuickAction();
  render();
}

function validateQuickAction(data) {
  const errors = [];
  if (data.actionType === "note") {
    if (!data.note?.trim()) errors.push({ field: "note", message: "Add a note before saving." });
    return errors;
  }
  if (!data.nextAction?.trim()) errors.push({ field: "nextAction", message: "Next action is required." });
  if (!data.nextActionDue) errors.push({ field: "nextActionDue", message: "Due date is required." });
  return errors;
}

function closeQuickAction() {
  closeLayer(document.getElementById("quick-action-modal"));
  state.pendingQuickAction = null;
}

function handleDragStart(event) {
  const card = event.target.closest("[data-lead-card]");
  if (!card || !FINE_POINTER.matches || event.target.closest("button, details, summary, input, select, textarea")) return;
  state.draggingLeadId = card.dataset.leadCard;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggingLeadId);
  window.requestAnimationFrame(() => card.classList.add("is-dragging"));
}

function handleDragOver(event) {
  const dropZone = event.target.closest("[data-stage-drop]");
  if (!dropZone || !state.draggingLeadId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setActiveDropZone(dropZone);
}

function handleDragLeave(event) {
  const dropZone = event.target.closest("[data-stage-drop]");
  if (!dropZone || dropZone.contains(event.relatedTarget)) return;
  dropZone.classList.remove("is-drag-over");
}

function handleDrop(event) {
  const dropZone = event.target.closest("[data-stage-drop]");
  if (!dropZone || !state.draggingLeadId) return;
  event.preventDefault();
  const leadId = event.dataTransfer.getData("text/plain") || state.draggingLeadId;
  const stageId = dropZone.dataset.stageDrop;
  clearDropState();
  openStageTransition(leadId, stageId, dropZone);
}

function handleDragEnd() {
  clearDropState();
}

function setActiveDropZone(dropZone) {
  document.querySelectorAll(".stage-column.is-drag-over").forEach((column) => {
    if (column !== dropZone) column.classList.remove("is-drag-over");
  });
  dropZone.classList.add("is-drag-over");
}

function clearDropState() {
  state.draggingLeadId = "";
  document.querySelectorAll(".is-drag-over, .is-dragging").forEach((element) => {
    element.classList.remove("is-drag-over", "is-dragging");
  });
}

function clearErrors(form, summary) {
  form.querySelectorAll("[aria-invalid='true']").forEach((field) => field.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field-error").forEach((node) => {
    node.textContent = "";
  });
  if (summary) {
    summary.hidden = true;
    summary.innerHTML = "";
  }
}

function showErrors(form, summary, errors) {
  errors.forEach((error) => {
    const field = form.elements[error.field];
    if (!field) return;
    field.setAttribute("aria-invalid", "true");
    const message = form.querySelector(`[data-error-for="${error.field}"]`);
    if (message) message.textContent = error.message;
  });
  if (summary) {
    summary.hidden = false;
    summary.innerHTML = `
      <strong>Fix the following:</strong>
      <ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join("")}</ul>
    `;
    summary.focus();
  }
  const firstField = form.elements[errors[0].field];
  if (firstField) firstField.focus();
}

function openLayer(layer) {
  layer.hidden = false;
  document.body.classList.add("has-modal");
  document.getElementById("app-shell").inert = true;
}

function closeLayer(layer) {
  layer.hidden = true;
  if (document.getElementById("lead-modal").hidden && document.getElementById("lead-drawer").hidden && document.getElementById("stage-modal").hidden && document.getElementById("quick-action-modal").hidden) {
    document.body.classList.remove("has-modal");
    document.getElementById("app-shell").inert = false;
  }
  if (state.previousFocus && typeof state.previousFocus.focus === "function") {
    state.previousFocus.focus();
  }
}

function handleGlobalKeydown(event) {
  const activeLayer = getActiveLayer();
  if (!activeLayer) return;
  if (event.key === "Escape") {
    if (activeLayer.id === "lead-modal") requestCloseLeadModal();
    if (activeLayer.id === "lead-drawer") closeDrawer();
    if (activeLayer.id === "stage-modal") closeStageModal();
    if (activeLayer.id === "quick-action-modal") closeQuickAction();
    return;
  }
  if (event.key === "Tab") trapFocus(activeLayer, event);
}

function trapFocus(container, event) {
  const focusable = getFocusable(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function getFocusable(container) {
  return Array.from(container.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"))
    .filter((element) => element.offsetParent !== null);
}

function getActiveLayer() {
  return [document.getElementById("quick-action-modal"), document.getElementById("stage-modal"), document.getElementById("lead-modal"), document.getElementById("lead-drawer")]
    .find((layer) => layer && !layer.hidden);
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
  if (!year || !month || !day) return String(value);
  return `${Number(month)}/${Number(day)}/${year}`;
}

function stageAgeStatus(lead) {
  const days = daysInCurrentStage(lead, TODAY());
  const benchmark = STAGE_BENCHMARK_DAYS[lead.stageId] || 0;
  if (!benchmark) {
    return { status: "neutral", label: `${days}d in stage` };
  }
  if (days > benchmark) {
    return { status: "red", label: `${days}d / ${benchmark}d benchmark` };
  }
  if (days === benchmark) {
    return { status: "yellow", label: `${days}d / ${benchmark}d benchmark` };
  }
  return { status: "green", label: `${days}d / ${benchmark}d benchmark` };
}

function getWarningLabel(lead, status) {
  const age = stageAgeStatus(lead);
  if (age.status === "red") return `Over stage benchmark: ${age.label}`;
  if (status.status === "overdue") return `Overdue next action: ${status.label}`;
  if (isAgingQuoteLead(lead, { today: TODAY() })) return "Aging quote: open 8+ days";
  if (isStaleLead(lead, { today: TODAY() })) return "Stale: no recent activity";
  if (isNoNextActionLead(lead)) return "Needs next action";
  return "";
}

function statusIcon(status) {
  if (status === "overdue") return "[!]";
  if (status === "today") return "[*]";
  if (status === "none") return "[-]";
  return "[ ]";
}

function findLead(id) {
  return state.leads.find((lead) => lead.id === id);
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function exportReportCsv() {
  const rows = calculateRepMetrics(filteredLeads(), { today: TODAY() });
  const csv = toCsv(rows, [
    { label: "Rep", key: "repName" },
    { label: "Leads Assigned", key: "leadsAssigned" },
    { label: "Overdue Actions", key: "overdueActions" },
    { label: "Due Today", key: "dueTodayActions" },
    { label: "No Next Action", key: "noNextAction" },
    { label: "Stale Leads", key: "staleLeads" },
    { label: "Quotes Sent", key: "quotesSent" },
    { label: "Total Quoted Revenue", key: "totalQuotedRevenue" },
    { label: "Open Potential Revenue", key: "openPotentialRevenue" },
    { label: "Won Jobs", key: "wonJobs" },
    { label: "Lost Jobs", key: "lostJobs" },
    { label: "Win Rate", value: (row) => Math.round(row.winRate * 100) + "%" },
    { label: "Won Revenue", key: "wonRevenue" },
    { label: "Realized Revenue", key: "realizedRevenue" },
    { label: "Average Days to Quote", value: (row) => row.averageDaysToQuote.toFixed(1) }
  ]);
  downloadCsv(csv, `cis-lead-report-${TODAY()}.csv`);
}

function exportLeadsCsv() {
  const csv = toCsv(filteredLeads(), [
    { label: "Measure Work Order Number", key: "externalLeadId" },
    { label: "Customer", key: "customerName" },
    { label: "Rep", key: "repName" },
    { label: "Phone Number", key: "contactPhone" },
    { label: "Email Address", key: "contactEmail" },
    { label: "Source", key: "source" },
    { label: "Path", key: "jobPath" },
    { label: "Street", key: "street" },
    { label: "City", key: "city" },
    { label: "State", key: "state" },
    { label: "ZIP Code", key: "zipCode" },
    { label: "Store", key: "storeNumber" },
    { label: "Product", key: "productType" },
    { label: "Stage", value: (lead) => STAGE_BY_ID[lead.stageId].name },
    { label: "Received", key: "dateReceived" },
    { label: "Measure Scheduled", key: "measureScheduledDate" },
    { label: "Next Action", key: "nextAction" },
    { label: "Next Action Due", key: "nextActionDue" },
    { label: "Last Activity", key: "lastActivityAt" },
    { label: "Days In Stage", value: (lead) => daysInCurrentStage(lead, TODAY()) },
    { label: "Quote Amount", key: "quoteAmount" },
    { label: "Quote Sent", key: "quoteSentDate" },
    { label: "Won Date", key: "soldDate" },
    { label: "Payment Status", key: "paymentStatus" },
    { label: "Install Scheduled", key: "installScheduledDate" },
    { label: "Closed Date", key: "closedDate" },
    { label: "Realized Revenue", key: "realizedRevenue" },
    { label: "Lost Reason", key: "lostReason" },
    { label: "Lost Date", key: "lostDate" },
    { label: "Notes", key: "notes" },
    { label: "Activity Trail", value: (lead) => (lead.activityLog || []).map((entry) => `${entry.at}: ${entry.label}`).join(" | ") }
  ]);
  downloadCsv(csv, `cis-leads-${TODAY()}.csv`);
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function showStatus(message, isError, action) {
  const toast = document.getElementById("app-status");
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    ${action ? `<button class="toast-action" type="button">${escapeHtml(action.label)}</button>` : ""}
  `;
  toast.classList.toggle("is-error", Boolean(isError));
  toast.classList.add("is-visible");
  if (action) {
    toast.querySelector("button").addEventListener("click", action.action, { once: true });
  }
  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => {
    toast.textContent = "";
    toast.classList.remove("is-visible", "is-error");
  }, action ? 7000 : 3500);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
