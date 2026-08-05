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

const STORAGE_KEY = "cis-lead-crm-v1";

const sampleLeads = [
  {
    id: "lead-001",
    externalLeadId: "F10482901",
    source: "HDSC",
    jobPath: "SFI",
    customerName: "Northview Charter School",
    repName: "Tyler",
    address: "Fort Worth, TX",
    storeNumber: "6512",
    productType: "Carpet tile",
    stageId: "quote_customer_decision",
    dateReceived: "2026-07-20",
    measureCompletedDate: "2026-07-23",
    quoteAmount: 18450,
    quoteSentDate: "2026-07-25",
    notes: "Board review expected this week."
  },
  {
    id: "lead-002",
    externalLeadId: "F10483277",
    source: "HDSC",
    jobPath: "F&I",
    customerName: "Mesa Retail Group",
    repName: "Mary",
    address: "Plano, TX",
    storeNumber: "5401",
    productType: "LVP",
    stageId: "sold_payment_gate",
    dateReceived: "2026-07-18",
    measureCompletedDate: "2026-07-22",
    quoteAmount: 32600,
    quoteSentDate: "2026-07-24",
    soldDate: "2026-07-29",
    notes: "Agreement signed. Payment link sent."
  },
  {
    id: "lead-003",
    externalLeadId: "F10484109",
    source: "Home Depot Store",
    jobPath: "SFI",
    customerName: "Grace Fellowship Hall",
    repName: "Sergio",
    address: "Denton, TX",
    storeNumber: "5890",
    productType: "Sheet vinyl",
    stageId: "measure_management",
    dateReceived: "2026-07-28",
    measureCompletedDate: "",
    quoteAmount: 0,
    quoteSentDate: "",
    notes: "HDMS measure requested."
  },
  {
    id: "lead-004",
    externalLeadId: "F10485522",
    source: "HDSC",
    jobPath: "SFI",
    customerName: "Riverside Office Suites",
    repName: "Tyler",
    address: "Arlington, TX",
    storeNumber: "5286",
    productType: "Broadloom",
    stageId: "install_closeout",
    dateReceived: "2026-07-05",
    measureCompletedDate: "2026-07-09",
    quoteAmount: 42125,
    quoteSentDate: "2026-07-11",
    soldDate: "2026-07-16",
    closedDate: "2026-08-01",
    realizedRevenue: 42125,
    notes: "Customer approval filed. No balance remains."
  },
  {
    id: "lead-005",
    externalLeadId: "F10486218",
    source: "Referral",
    jobPath: "SFI",
    customerName: "Harbor Childcare Center",
    repName: "Mary",
    address: "Dallas, TX",
    storeNumber: "0562",
    productType: "Rubber flooring",
    stageId: "lost_cancelled",
    dateReceived: "2026-07-10",
    measureCompletedDate: "2026-07-14",
    quoteAmount: 21900,
    quoteSentDate: "2026-07-16",
    lostReason: "Price",
    notes: "Customer selected a lower bid."
  },
  {
    id: "lead-006",
    externalLeadId: "F10487344",
    source: "HDSC",
    jobPath: "F&I",
    customerName: "Oakline Property Management",
    repName: "Sergio",
    address: "Irving, TX",
    storeNumber: "5417",
    productType: "Carpet",
    stageId: "intake_measure_prep",
    dateReceived: "2026-08-02",
    measureCompletedDate: "",
    quoteAmount: 0,
    quoteSentDate: "",
    notes: "Confirm access contact before scheduling."
  }
];

const state = {
  leads: loadLeads(),
  activeView: "board",
  draggingLeadId: "",
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
  render();
});

function loadLeads() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return sampleLeads.map(normalizeLead);
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeLead) : sampleLeads.map(normalizeLead);
  } catch {
    return sampleLeads.map(normalizeLead);
  }
}

function saveLeads() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.leads));
}

function bindEvents() {
  document.querySelectorAll(".nav-item, .view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });

  document.getElementById("lead-form").addEventListener("submit", saveLeadFromForm);
  document.getElementById("clear-form").addEventListener("click", clearForm);
  document.getElementById("reset-sample").addEventListener("click", () => {
    state.leads = sampleLeads.map(normalizeLead);
    saveLeads();
    clearForm();
    render();
  });
  document.getElementById("export-report").addEventListener("click", exportReportCsv);

  ["search-filter", "rep-filter", "stage-filter", "start-filter", "end-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateFiltersFromControls);
  });

  document.body.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton && viewButton.closest("#race-card")) {
      state.activeView = viewButton.dataset.view;
      render();
      return;
    }

    const editButton = event.target.closest("[data-edit-lead]");
    if (editButton) {
      editLead(editButton.dataset.editLead);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-lead]");
    if (deleteButton) {
      deleteLead(deleteButton.dataset.deleteLead);
      return;
    }

    const exportLeadsButton = event.target.closest("[data-export-leads]");
    if (exportLeadsButton) {
      exportLeadsCsv();
      return;
    }
  });

  document.body.addEventListener("change", (event) => {
    const stageSelect = event.target.closest("[data-stage-change]");
    if (stageSelect) {
      updateLeadStage(stageSelect.dataset.stageChange, stageSelect.value);
    }
  });

  document.body.addEventListener("dragstart", handleDragStart);
  document.body.addEventListener("dragover", handleDragOver);
  document.body.addEventListener("dragleave", handleDragLeave);
  document.body.addEventListener("drop", handleDrop);
  document.body.addEventListener("dragend", handleDragEnd);
}

function hydrateStageOptions() {
  const stageSelect = document.getElementById("stage-select");
  stageSelect.innerHTML = PIPELINE_STAGES.map((stage) => {
    return `<option value="${stage.id}">${stage.name}</option>`;
  }).join("");

  const stageFilter = document.getElementById("stage-filter");
  stageFilter.innerHTML = [
    '<option value="all">All stages</option>',
    ...PIPELINE_STAGES.map((stage) => `<option value="${stage.id}">${stage.name}</option>`)
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
  renderRepOptions();
  renderTeamMetrics(visibleLeads);
  renderRaceCard(visibleLeads);
  renderViews(visibleLeads);
  renderNav();
}

function renderRepOptions() {
  const select = document.getElementById("rep-filter");
  const current = select.value || state.filters.rep;
  const reps = Array.from(new Set(state.leads.map((lead) => lead.repName).filter(Boolean))).sort();
  select.innerHTML = [
    '<option value="all">All reps</option>',
    ...reps.map((rep) => `<option value="${escapeHtml(rep)}">${escapeHtml(rep)}</option>`)
  ].join("");
  select.value = reps.includes(current) ? current : "all";
  state.filters.rep = select.value;
}

function renderTeamMetrics(leads) {
  const totals = calculateTeamMetrics(leads);
  const metrics = [
    ["Leads", formatNumber(totals.leadsAssigned), "Assigned in current filter"],
    ["Quotes Sent", formatNumber(totals.quotesSent), `${formatCurrency(totals.totalQuotedRevenue)} quoted`],
    ["Open Potential", formatCurrency(totals.openPotentialRevenue), "Quoted, not won or lost"],
    ["Won Revenue", formatCurrency(totals.wonRevenue), `${formatPercent(totals.winRate)} win rate`],
    ["Realized Revenue", formatCurrency(totals.realizedRevenue), "Closed-out final value"],
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

function renderRaceCard(leads) {
  const metrics = calculateRepMetrics(leads).slice(0, 3);
  const fallback = ["Tyler", "Mary", "Sergio"].map((repName) => ({
    repName,
    wonRevenue: 0,
    realizedRevenue: 0,
    leadsAssigned: 0
  }));
  const rows = metrics.length ? metrics : fallback;

  document.getElementById("race-card").innerHTML = `
    <div class="race-header">
      <div>
        <div class="race-title">
          <h3>The Race</h3>
          <span>${rows.map((row) => escapeHtml(row.repName)).join(" - ")}</span>
        </div>
        <div class="race-tabs">
          <button class="is-active" type="button">This week</button>
          <button type="button">This month</button>
        </div>
      </div>
      <button class="text-button" data-view="report" type="button">Full stats -></button>
    </div>
    <div class="race-grid">
      ${rows.map((row, index) => {
        const initials = row.repName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const value = row.realizedRevenue || row.wonRevenue || row.openPotentialRevenue || 0;
        return `
          <article class="race-person ${index === 0 ? "is-leading" : ""}">
            <span class="race-rank">${index + 1}</span>
            <span class="race-avatar">${escapeHtml(initials)}</span>
            <div>
              <h4>${escapeHtml(row.repName)}</h4>
              <p>${index === 0 ? "Leading" : `${formatCurrency(value)} tracked`}</p>
            </div>
            <div class="race-points">
              <strong>${formatNumber(row.leadsAssigned)}</strong>
              <span>leads</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderViews(leads) {
  document.querySelectorAll(".view-pane").forEach((pane) => pane.classList.remove("is-active"));
  document.getElementById(`${state.activeView}-view`).classList.add("is-active");
  renderBoard(leads);
  renderTable(leads);
  renderReport(leads);
}

function renderNav() {
  document.querySelectorAll(".nav-item, .view-tab").forEach((button) => {
    const isSecondary = button.dataset.secondary === "true";
    button.classList.toggle("is-active", !isSecondary && button.dataset.view === state.activeView);
  });
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
          <section class="stage-column" data-stage-column="${stage.id}" data-stage-drop="${stage.id}" aria-label="${escapeHtml(stage.name)} drop zone">
            <div class="stage-heading">
              <div>
                <h3>${stage.name}</h3>
                <p>${stageLeads.length} ${stageLeads.length === 1 ? "lead" : "leads"}</p>
              </div>
              <strong>${formatCurrency(stageRevenue)}</strong>
            </div>
            <div class="stage-cards">
              ${stageLeads.length ? stageLeads.map(renderLeadCard).join("") : '<p class="empty-state">Drop leads here.</p>'}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderLeadCard(lead) {
  return `
    <article class="lead-card ${state.draggingLeadId === lead.id ? "is-dragging" : ""}" draggable="true" data-lead-card="${lead.id}" aria-label="${escapeHtml(lead.customerName)} opportunity card" aria-grabbed="${state.draggingLeadId === lead.id ? "true" : "false"}">
      <div class="card-topline">
        <span class="drag-grip" aria-hidden="true">::</span>
        <span>${escapeHtml(lead.externalLeadId)}</span>
        <span>${escapeHtml(lead.repName)}</span>
      </div>
      <h4>${escapeHtml(lead.customerName)}</h4>
      <p>${escapeHtml(lead.productType || "Product TBD")} ${lead.storeNumber ? `- Store #${escapeHtml(lead.storeNumber)}` : ""}</p>
      <dl>
        <div><dt>Quote</dt><dd>${lead.quoteAmount ? formatCurrency(lead.quoteAmount) : "Not sent"}</dd></div>
        <div><dt>Sent</dt><dd>${lead.quoteSentDate || "Open"}</dd></div>
      </dl>
      <div class="card-actions">
        <button class="text-button" data-edit-lead="${lead.id}" type="button">Edit</button>
        <button class="text-button danger" data-delete-lead="${lead.id}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function renderTable(leads) {
  document.getElementById("table-view").innerHTML = `
    <div class="table-toolbar">
      <p>${leads.length} leads in view</p>
      <button class="button secondary" data-export-leads type="button">Export Leads CSV</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Lead</th>
            <th>Customer</th>
            <th>Rep</th>
            <th>Stage</th>
            <th>Received</th>
            <th>Quote Sent</th>
            <th>Quote</th>
            <th>Outcome</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${leads.map((lead) => `
            <tr>
              <td>${escapeHtml(lead.externalLeadId)}</td>
              <td>${escapeHtml(lead.customerName)}</td>
              <td>${escapeHtml(lead.repName)}</td>
              <td>${escapeHtml(STAGE_BY_ID[lead.stageId].shortName)}</td>
              <td>${lead.dateReceived || ""}</td>
              <td>${lead.quoteSentDate || ""}</td>
              <td>${lead.quoteAmount ? formatCurrency(lead.quoteAmount) : ""}</td>
              <td>${lead.lostReason ? escapeHtml(lead.lostReason) : lead.soldDate ? "Won" : ""}</td>
              <td><button class="text-button" data-edit-lead="${lead.id}" type="button">Edit</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReport(leads) {
  const metrics = calculateRepMetrics(leads);
  const totals = calculateTeamMetrics(leads);
  document.getElementById("report-view").innerHTML = `
    <section class="report-sheet" id="print-report">
      <div class="report-header">
        <div>
          <p class="eyebrow">Leadership export</p>
          <h3>CIS Lead-to-Revenue Summary</h3>
        </div>
        <button class="button secondary" onclick="window.print()" type="button">Print Report</button>
      </div>
      <div class="report-summary">
        <p><strong>${formatNumber(totals.leadsAssigned)}</strong> leads assigned</p>
        <p><strong>${formatNumber(totals.quotesSent)}</strong> quotes sent</p>
        <p><strong>${formatCurrency(totals.openPotentialRevenue)}</strong> open potential</p>
        <p><strong>${formatCurrency(totals.realizedRevenue)}</strong> realized revenue</p>
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
    </section>
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
  render();
}

function validateLead(lead) {
  const stageSort = STAGE_BY_ID[lead.stageId].sort;
  if (stageSort >= STAGE_BY_ID.quote_customer_decision.sort && lead.stageId !== "lost_cancelled" && !lead.quoteAmount) {
    return "Quote amount is required once a lead reaches quote or later.";
  }
  if (stageSort >= STAGE_BY_ID.quote_customer_decision.sort && lead.stageId !== "lost_cancelled" && !lead.quoteSentDate) {
    return "Quote sent date is required once a lead reaches quote or later.";
  }
  if (lead.stageId === "lost_cancelled" && !lead.lostReason) {
    return "Choose a lost reason before closing the lead.";
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
  document.querySelector(".lead-form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  const confirmed = window.confirm(`Delete ${lead.customerName}?`);
  if (!confirmed) return;
  state.leads = state.leads.filter((item) => item.id !== id);
  saveLeads();
  render();
}

function updateLeadStage(id, stageId) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || !STAGE_BY_ID[stageId]) return;
  const previousStageId = lead.stageId;
  lead.stageId = stageId;
  if (stageId === "sold_payment_gate" && !lead.soldDate) lead.soldDate = today();
  if (stageId === "install_closeout" && !lead.closedDate && lead.soldDate) lead.realizedRevenue = lead.realizedRevenue || lead.quoteAmount;
  if (stageId === "lost_cancelled" && !lead.lostReason) lead.lostReason = "No Longer Interested";
  saveLeads();
  render();
  if (previousStageId !== stageId) showStatus(`Moved to ${STAGE_BY_ID[stageId].name}`, false);
}

function handleDragStart(event) {
  const card = event.target.closest("[data-lead-card]");
  if (!card) return;
  state.draggingLeadId = card.dataset.leadCard;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggingLeadId);
  window.requestAnimationFrame(() => {
    card.classList.add("is-dragging");
  });
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
  dropZone.closest(".stage-column")?.classList.remove("is-drag-over");
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
  render();
}

function setActiveDropZone(dropZone) {
  document.querySelectorAll(".stage-column.is-drag-over").forEach((column) => {
    if (column !== dropZone.closest(".stage-column")) column.classList.remove("is-drag-over");
  });
  dropZone.closest(".stage-column")?.classList.add("is-drag-over");
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
  status.textContent = message;
  status.classList.toggle("is-error", Boolean(isError));
  window.setTimeout(() => {
    status.textContent = "";
    status.classList.remove("is-error");
  }, 3000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

clearForm();
