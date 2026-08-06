const {
  PIPELINE_STAGES,
  STAGE_BY_ID,
  normalizeLead,
  filterLeads,
  calculateRepMetrics,
  calculateTeamMetrics,
  formatCurrency,
  formatPercent,
  formatNumber,
  toCsv
} = window.CISReporting;

const STORAGE_KEY = "cis-lead-crm-v2";

const state = {
  leads: loadLeads(),
  draggingLeadId: "",
  editingLeadId: "",
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
  clearForm();
  render();
});

function loadLeads() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeLead) : [];
  } catch {
    return [];
  }
}

function saveLeads() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.leads));
}

function bindEvents() {
  document.getElementById("new-lead").addEventListener("click", () => {
    clearForm();
    openLeadModal();
  });
  document.getElementById("lead-form").addEventListener("submit", saveLeadFromForm);
  document.getElementById("clear-form").addEventListener("click", clearForm);
  document.getElementById("close-modal").addEventListener("click", closeLeadModal);
  document.getElementById("cancel-modal").addEventListener("click", closeLeadModal);
  document.getElementById("export-report").addEventListener("click", exportReportCsv);
  document.getElementById("export-leads").addEventListener("click", exportLeadsCsv);

  ["search-filter", "rep-filter", "stage-filter", "start-filter", "end-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateFiltersFromControls);
  });

  document.body.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-lead]");
    if (editButton) {
      editLead(editButton.dataset.editLead);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-lead]");
    if (deleteButton) {
      deleteLead(deleteButton.dataset.deleteLead);
    }
  });

  document.body.addEventListener("change", (event) => {
    const stageSelect = event.target.closest("[data-stage-change]");
    if (stageSelect) {
      updateLeadStage(stageSelect.dataset.stageChange, stageSelect.value);
    }
  });

  document.getElementById("lead-modal").addEventListener("click", (event) => {
    if (event.target.id === "lead-modal") closeLeadModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isLeadModalOpen()) closeLeadModal();
  });

  document.body.addEventListener("dragstart", handleDragStart);
  document.body.addEventListener("dragover", handleDragOver);
  document.body.addEventListener("dragleave", handleDragLeave);
  document.body.addEventListener("drop", handleDrop);
  document.body.addEventListener("dragend", handleDragEnd);
}

function hydrateStageOptions() {
  const stageOptions = PIPELINE_STAGES.map((stage) => `<option value="${stage.id}">${stage.name}</option>`).join("");
  document.getElementById("stage-select").innerHTML = stageOptions;
  document.getElementById("stage-filter").innerHTML = [
    '<option value="all">All stages</option>',
    stageOptions
  ].join("");
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
  const visibleLeads = filteredLeads();
  renderRepControls();
  renderTeamMetrics(visibleLeads);
  renderBoard(visibleLeads);
  renderReport(visibleLeads);
  document.getElementById("board-count").textContent = `${visibleLeads.length} ${visibleLeads.length === 1 ? "lead" : "leads"} in view`;
}

function renderRepControls() {
  const reps = Array.from(new Set(state.leads.map((lead) => lead.repName).filter(Boolean))).sort();

  const filter = document.getElementById("rep-filter");
  const currentFilter = filter.value || state.filters.rep;
  filter.innerHTML = [
    '<option value="all">All reps</option>',
    ...reps.map((rep) => `<option value="${escapeHtml(rep)}">${escapeHtml(rep)}</option>`)
  ].join("");
  filter.value = reps.includes(currentFilter) ? currentFilter : "all";
  state.filters.rep = filter.value;

  document.getElementById("rep-options").innerHTML = reps.map((rep) => `<option value="${escapeHtml(rep)}"></option>`).join("");
}

function renderTeamMetrics(leads) {
  const totals = calculateTeamMetrics(leads);
  const metrics = [
    ["Leads", formatNumber(totals.leadsAssigned), "Assigned"],
    ["Quotes Sent", formatNumber(totals.quotesSent), formatCurrency(totals.totalQuotedRevenue)],
    ["Open Potential", formatCurrency(totals.openPotentialRevenue), "Quoted, not decided"],
    ["Won Revenue", formatCurrency(totals.wonRevenue), `${formatPercent(totals.winRate)} win rate`],
    ["Realized", formatCurrency(totals.realizedRevenue), "Closed-out revenue"],
    ["Aging Quotes", formatNumber(totals.agingOpenQuotes), `${formatCurrency(totals.agingOpenQuoteRevenue)} at 8+ days`]
  ];

  document.getElementById("team-metrics").innerHTML = metrics.map(([label, value, helper]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${helper}</small>
    </article>
  `).join("");
}

function renderBoard(leads) {
  const grouped = PIPELINE_STAGES.map((stage) => ({
    stage,
    leads: leads.filter((lead) => lead.stageId === stage.id)
  }));

  document.getElementById("board-view").innerHTML = `
    <div class="stage-board">
      ${grouped.map(({ stage, leads: stageLeads }) => {
        const stageRevenue = stageLeads.reduce((sum, lead) => sum + Number(lead.quoteAmount || 0), 0);
        return `
          <section class="stage-column" data-stage-column="${stage.id}" data-stage-drop="${stage.id}" aria-label="${escapeHtml(stage.name)}">
            <div class="stage-heading">
              <div>
                <h3>${escapeHtml(stage.shortName)}</h3>
                <p>${stageLeads.length} ${stageLeads.length === 1 ? "lead" : "leads"}</p>
              </div>
              <strong>${formatCurrency(stageRevenue)}</strong>
            </div>
            <div class="stage-cards">
              ${stageLeads.length ? stageLeads.map(renderLeadCard).join("") : '<p class="empty-state">No leads</p>'}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderLeadCard(lead) {
  const stage = STAGE_BY_ID[lead.stageId];
  const outcome = lead.stageId === "lost_cancelled" ? "Lost" : lead.soldDate ? "Won" : "Open";
  const realized = lead.realizedRevenue || (lead.closedDate ? lead.quoteAmount : 0);

  return `
    <article class="lead-card" draggable="true" data-lead-card="${lead.id}" aria-label="${escapeHtml(lead.customerName)}">
      <div class="card-topline">
        <span class="drag-grip" aria-hidden="true">::</span>
        <span>${escapeHtml(lead.externalLeadId)}</span>
        <span class="rep-pill">${escapeHtml(lead.repName)}</span>
      </div>

      <div>
        <h4>${escapeHtml(lead.customerName)}</h4>
        <p>${escapeHtml(lead.address || "Location TBD")}</p>
      </div>

      <dl class="card-facts">
        <div><dt>Quote</dt><dd>${lead.quoteAmount ? formatCurrency(lead.quoteAmount) : "Not quoted"}</dd></div>
        <div><dt>Quote sent</dt><dd>${lead.quoteSentDate || "-"}</dd></div>
        <div><dt>Outcome</dt><dd>${outcome}</dd></div>
        <div><dt>Realized</dt><dd>${realized ? formatCurrency(realized) : "-"}</dd></div>
      </dl>

      <label class="card-stage">
        Stage
        <select data-stage-change="${lead.id}" aria-label="Stage for ${escapeHtml(lead.customerName)}">
          ${PIPELINE_STAGES.map((option) => `
            <option value="${option.id}" ${option.id === stage.id ? "selected" : ""}>${escapeHtml(option.shortName)}</option>
          `).join("")}
        </select>
      </label>

      <div class="card-actions">
        <button class="text-button" data-edit-lead="${lead.id}" type="button">Edit</button>
        <button class="text-button danger" data-delete-lead="${lead.id}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function renderReport(leads) {
  const metrics = calculateRepMetrics(leads);
  const totals = calculateTeamMetrics(leads);

  document.getElementById("report-view").innerHTML = `
    <div class="report-summary">
      <p><strong>${formatNumber(totals.leadsAssigned)}</strong><span>Leads</span></p>
      <p><strong>${formatNumber(totals.quotesSent)}</strong><span>Quotes</span></p>
      <p><strong>${formatCurrency(totals.openPotentialRevenue)}</strong><span>Open potential</span></p>
      <p><strong>${formatCurrency(totals.realizedRevenue)}</strong><span>Realized</span></p>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rep</th>
            <th>Leads</th>
            <th>Ran</th>
            <th>Quotes</th>
            <th>Quoted $</th>
            <th>Open Potential</th>
            <th>Won Jobs</th>
            <th>Lost Jobs</th>
            <th>Win Rate</th>
            <th>Won $</th>
            <th>Realized $</th>
            <th>Avg Days to Quote</th>
            <th>Aging Quotes</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.map((row) => `
            <tr>
              <td>${escapeHtml(row.repName)}</td>
              <td>${formatNumber(row.leadsAssigned)}</td>
              <td>${formatNumber(row.leadsRun)}</td>
              <td>${formatNumber(row.quotesSent)}</td>
              <td>${formatCurrency(row.totalQuotedRevenue)}</td>
              <td>${formatCurrency(row.openPotentialRevenue)}</td>
              <td>${formatNumber(row.wonJobs)}</td>
              <td>${formatNumber(row.lostJobs)}</td>
              <td>${formatPercent(row.winRate)}</td>
              <td>${formatCurrency(row.wonRevenue)}</td>
              <td>${formatCurrency(row.realizedRevenue)}</td>
              <td>${formatNumber(row.averageDaysToQuote, 1)}</td>
              <td>${formatNumber(row.agingOpenQuotes)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function saveLeadFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const lead = normalizeLead({
    ...data,
    id: data.id || createId(),
    quoteAmount: data.quoteAmount,
    realizedRevenue: data.realizedRevenue
  });

  applyStageDefaults(lead);

  const validationMessage = validateLead(lead);
  if (validationMessage) {
    showStatus(validationMessage, true);
    return;
  }

  const index = state.leads.findIndex((item) => item.id === lead.id);
  if (index >= 0) {
    state.leads[index] = lead;
  } else {
    state.leads.unshift(lead);
  }

  saveLeads();
  clearForm();
  showStatus("Saved", false);
  closeLeadModal();
  render();
}

function validateLead(lead) {
  const stageSort = STAGE_BY_ID[lead.stageId].sort;
  const quoteStageSort = STAGE_BY_ID.quote_customer_decision.sort;
  if (stageSort >= quoteStageSort && lead.stageId !== "lost_cancelled" && !lead.quoteAmount) {
    return "Quote amount is required once a lead reaches Quote or later.";
  }
  if (stageSort >= quoteStageSort && lead.stageId !== "lost_cancelled" && !lead.quoteSentDate) {
    return "Quote sent date is required once a lead reaches Quote or later.";
  }
  return "";
}

function editLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;

  const form = document.getElementById("lead-form");
  Object.entries(lead).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });

  state.editingLeadId = id;
  document.getElementById("lead-form-title").textContent = "Edit lead";
  openLeadModal();
  showStatus(`Editing ${lead.externalLeadId || lead.customerName}`, false);
}

function deleteLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  const confirmed = window.confirm(`Delete ${lead.customerName}?`);
  if (!confirmed) return;
  state.leads = state.leads.filter((item) => item.id !== id);
  saveLeads();
  if (state.editingLeadId === id) clearForm();
  render();
}

function updateLeadStage(id, stageId) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || !STAGE_BY_ID[stageId]) return;

  const nextLead = normalizeLead({ ...lead, stageId });
  applyStageDefaults(nextLead);
  const validationMessage = validateLead(nextLead);
  if (validationMessage) {
    editLead(id);
    document.getElementById("stage-select").value = stageId;
    showStatus(validationMessage, true);
    render();
    return;
  }

  Object.assign(lead, nextLead);
  saveLeads();
  showStatus(`Moved to ${STAGE_BY_ID[stageId].name}`, false);
  render();
}

function applyStageDefaults(lead) {
  if (lead.stageId === "sold_payment_gate" && !lead.soldDate) {
    lead.soldDate = today();
  }
  if (lead.stageId === "install_closeout") {
    if (!lead.soldDate) lead.soldDate = today();
    if (!lead.closedDate) lead.closedDate = today();
    if (!lead.realizedRevenue) lead.realizedRevenue = lead.quoteAmount;
  }
  if (lead.stageId === "lost_cancelled") {
    lead.soldDate = "";
    lead.closedDate = "";
    lead.realizedRevenue = 0;
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-lead-card]");
  if (!card) return;
  if (event.target.closest("button, select, input, textarea")) return;

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
  if (!dropZone) return;

  event.preventDefault();
  const leadId = event.dataTransfer.getData("text/plain") || state.draggingLeadId;
  const stageId = dropZone.dataset.stageDrop;
  clearDropState();
  updateLeadStage(leadId, stageId);
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

function clearForm() {
  const form = document.getElementById("lead-form");
  form.reset();
  form.elements.id.value = "";
  form.elements.dateReceived.value = today();
  form.elements.stageId.value = "intake_measure_prep";
  state.editingLeadId = "";
  document.getElementById("lead-form-title").textContent = "New lead";
}

function openLeadModal() {
  const modal = document.getElementById("lead-modal");
  modal.hidden = false;
  document.body.classList.add("has-modal");
  window.setTimeout(() => {
    document.querySelector('#lead-form input[name="externalLeadId"]')?.focus();
  }, 0);
}

function closeLeadModal() {
  document.getElementById("lead-modal").hidden = true;
  document.body.classList.remove("has-modal");
}

function isLeadModalOpen() {
  return !document.getElementById("lead-modal").hidden;
}

function exportReportCsv() {
  const rows = calculateRepMetrics(filteredLeads());
  const csv = toCsv(rows, [
    { label: "Rep", key: "repName" },
    { label: "Leads Assigned", key: "leadsAssigned" },
    { label: "Leads Run", key: "leadsRun" },
    { label: "Quotes Sent", key: "quotesSent" },
    { label: "Total Quoted Revenue", key: "totalQuotedRevenue" },
    { label: "Open Potential Revenue", key: "openPotentialRevenue" },
    { label: "Won Jobs", key: "wonJobs" },
    { label: "Lost Jobs", key: "lostJobs" },
    { label: "Win Rate", value: (row) => Math.round(row.winRate * 100) + "%" },
    { label: "Won Revenue", key: "wonRevenue" },
    { label: "Realized Revenue", key: "realizedRevenue" },
    { label: "Average Days to Quote", value: (row) => row.averageDaysToQuote.toFixed(1) },
    { label: "Aging Open Quotes", key: "agingOpenQuotes" },
    { label: "Aging Open Quote Revenue", key: "agingOpenQuoteRevenue" }
  ]);
  downloadCsv(csv, `cis-lead-report-${today()}.csv`);
}

function exportLeadsCsv() {
  const csv = toCsv(filteredLeads(), [
    { label: "Lead ID", key: "externalLeadId" },
    { label: "Customer", key: "customerName" },
    { label: "Rep", key: "repName" },
    { label: "Source", key: "source" },
    { label: "Path", key: "jobPath" },
    { label: "Store", key: "storeNumber" },
    { label: "Product", key: "productType" },
    { label: "Stage", value: (lead) => STAGE_BY_ID[lead.stageId].name },
    { label: "Received", key: "dateReceived" },
    { label: "Measure Completed", key: "measureCompletedDate" },
    { label: "Quote Amount", key: "quoteAmount" },
    { label: "Quote Sent", key: "quoteSentDate" },
    { label: "Won Date", key: "soldDate" },
    { label: "Closed Date", key: "closedDate" },
    { label: "Realized Revenue", key: "realizedRevenue" },
    { label: "Lost Reason", key: "lostReason" },
    { label: "Notes", key: "notes" }
  ]);
  downloadCsv(csv, `cis-leads-${today()}.csv`);
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

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function showStatus(message, isError) {
  const status = document.getElementById("form-status");
  const toast = document.getElementById("app-status");
  if (status) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }
  toast.textContent = message;
  toast.classList.toggle("is-error", Boolean(isError));
  toast.classList.add("is-visible");
  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => {
    if (status) {
      status.textContent = "";
      status.classList.remove("is-error");
    }
    toast.textContent = "";
    toast.classList.remove("is-visible", "is-error");
  }, 3500);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
