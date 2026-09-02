(function attachReporting(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CISReporting = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildReporting() {
  const PIPELINE_STAGES = [
    {
      id: "intake_measure_prep",
      name: "Intake & Measure Prep",
      shortName: "Intake",
      sort: 10,
      revenueState: "pre_quote",
      description: "Lead is assigned, customer/job details are verified, and the measure path is set."
    },
    {
      id: "measure_management",
      name: "Measure Management",
      shortName: "Measure",
      sort: 20,
      revenueState: "pre_quote",
      description: "Measure is scheduled, completed, retrieved, and usable for quoting."
    },
    {
      id: "quote_customer_decision",
      name: "Quote & Customer Decision",
      shortName: "Quote",
      sort: 30,
      revenueState: "open_potential",
      description: "Quote is built, sent, and followed until the customer accepts, declines, or needs more time."
    },
    {
      id: "sold_payment_gate",
      name: "Sold / Payment Gate",
      shortName: "Sold",
      sort: 40,
      revenueState: "won",
      description: "Customer accepted, documents are signed, and required payment is being secured."
    },
    {
      id: "install_closeout",
      name: "Install & Close-Out",
      shortName: "Close-Out",
      sort: 50,
      revenueState: "won",
      description: "Material, install, completion approval, final payment, and closeout are being handled."
    },
    {
      id: "lost_cancelled",
      name: "Lost / Cancelled",
      shortName: "Lost",
      sort: 60,
      revenueState: "lost",
      description: "Terminal bucket for no contact, declined, out of scope, cancelled, or duplicate leads."
    }
  ];

  const STORAGE_VERSION = 3;
  const STALE_DAYS = 14;
  const AGING_QUOTE_DAYS = 8;
  const STAGE_BY_ID = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage.id] = stage;
    return acc;
  }, {});

  const OPEN_QUOTE_STAGE_IDS = new Set(["quote_customer_decision"]);
  const WON_STAGE_IDS = new Set(["sold_payment_gate", "install_closeout"]);
  const LOST_STAGE_IDS = new Set(["lost_cancelled"]);
  const CLOSED_STAGE_IDS = new Set(["lost_cancelled"]);

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeDateText(value) {
    const text = normalizeText(value);
    if (!text) return "";
    const date = parseDate(text);
    return date ? toIsoDate(date) : text;
  }

  function normalizePriority(value) {
    const priority = normalizeText(value).toLowerCase();
    return ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
  }

  function normalizeActivityLog(value, fallbackDate) {
    const entries = Array.isArray(value) ? value : [];
    const normalized = entries
      .map((entry) => ({
        at: normalizeDateText(entry && entry.at),
        type: normalizeText(entry && entry.type) || "note",
        label: normalizeText(entry && entry.label)
      }))
      .filter((entry) => entry.at || entry.label);

    if (!normalized.length && fallbackDate) {
      normalized.push({
        at: fallbackDate,
        type: "created",
        label: "Lead received"
      });
    }

    return normalized.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  }

  function normalizeLead(lead) {
    const safeLead = lead || {};
    const stageId = STAGE_BY_ID[safeLead.stageId] ? safeLead.stageId : PIPELINE_STAGES[0].id;
    const dateReceived = normalizeDateText(safeLead.dateReceived);
    const stageEnteredAt = normalizeDateText(safeLead.stageEnteredAt) || dateReceived;
    const lastActivityAt = normalizeDateText(safeLead.lastActivityAt) || normalizeDateText(safeLead.quoteSentDate) || normalizeDateText(safeLead.measureCompletedDate) || dateReceived;
    const street = normalizeText(safeLead.street || safeLead.streetAddress || safeLead.jobStreet || safeLead.address || safeLead.jobAddress);
    const city = normalizeText(safeLead.city || safeLead.jobCity);
    const state = normalizeText(safeLead.state || safeLead.jobState);
    const zipCode = normalizeText(safeLead.zipCode || safeLead.zip || safeLead.postalCode || safeLead.jobZip);
    const address = normalizeText(safeLead.address || safeLead.jobAddress || [street, city, state, zipCode].filter(Boolean).join(", "));

    return {
      id: normalizeText(safeLead.id),
      externalLeadId: normalizeText(safeLead.externalLeadId),
      source: normalizeText(safeLead.source) || "HDSC",
      jobPath: normalizeText(safeLead.jobPath) || "SFI",
      customerName: normalizeText(safeLead.customerName),
      assignedTo: normalizeText(safeLead.assignedTo),
      repName: normalizeText(safeLead.repName) || "Unassigned",
      contactPhone: normalizeText(safeLead.contactPhone || safeLead.customerPhone),
      contactEmail: normalizeText(safeLead.contactEmail || safeLead.customerEmail),
      street,
      city,
      state,
      zipCode,
      address,
      storeNumber: normalizeText(safeLead.storeNumber),
      productType: normalizeText(safeLead.productType),
      stageId,
      dateReceived,
      measureScheduledDate: normalizeDateText(safeLead.measureScheduledDate),
      measureCompletedDate: normalizeDateText(safeLead.measureCompletedDate),
      quoteAmount: normalizeNumber(safeLead.quoteAmount),
      quoteSentDate: normalizeDateText(safeLead.quoteSentDate),
      soldDate: normalizeDateText(safeLead.soldDate),
      closedDate: normalizeDateText(safeLead.closedDate),
      realizedRevenue: normalizeNumber(safeLead.realizedRevenue),
      lostReason: normalizeText(safeLead.lostReason),
      lostDate: normalizeDateText(safeLead.lostDate),
      nextAction: normalizeText(safeLead.nextAction),
      nextActionDue: normalizeDateText(safeLead.nextActionDue),
      lastActivityAt,
      stageEnteredAt,
      expectedCloseDate: normalizeDateText(safeLead.expectedCloseDate),
      priority: normalizePriority(safeLead.priority),
      paymentStatus: normalizeText(safeLead.paymentStatus) || "Not requested",
      installScheduledDate: normalizeDateText(safeLead.installScheduledDate),
      notes: normalizeText(safeLead.notes),
      archivedAt: normalizeDateText(safeLead.archivedAt),
      activityLog: normalizeActivityLog(safeLead.activityLog || safeLead.activities, dateReceived)
    };
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = String(value).slice(0, 10);
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function todayIso() {
    return toIsoDate(new Date());
  }

  function daysBetween(startValue, endValue) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end) return null;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  function daysSince(value, todayValue) {
    const today = parseDate(todayValue) || parseDate(todayIso());
    const date = parseDate(value);
    if (!date || !today) return null;
    return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
  }

  function daysInCurrentStage(lead, todayValue) {
    const normalized = normalizeLead(lead);
    return daysSince(normalized.stageEnteredAt || normalized.dateReceived, todayValue) || 0;
  }

  function isWithinDateRange(value, startValue, endValue) {
    const date = parseDate(value);
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  }

  function isClosedLead(lead) {
    const normalized = normalizeLead(lead);
    return CLOSED_STAGE_IDS.has(normalized.stageId) || Boolean(normalized.closedDate);
  }

  function isLostLead(lead) {
    const normalized = normalizeLead(lead);
    return normalized.stageId === "lost_cancelled" || Boolean(normalized.lostDate);
  }

  function isCompletedLead(lead) {
    const normalized = normalizeLead(lead);
    return Boolean(normalized.closedDate) && !isLostLead(normalized);
  }

  function nextActionStatus(lead, todayValue) {
    const normalized = normalizeLead(lead);
    if (!normalized.nextAction || !normalized.nextActionDue) {
      return { status: "none", label: "No next action", daysDelta: null };
    }
    const diff = daysBetween(todayValue || todayIso(), normalized.nextActionDue);
    if (diff === null) return { status: "none", label: "No due date", daysDelta: null };
    if (diff < 0) return { status: "overdue", label: `${Math.abs(diff)}d overdue`, daysDelta: diff };
    if (diff === 0) return { status: "today", label: "Due today", daysDelta: diff };
    return { status: "upcoming", label: `Due in ${diff}d`, daysDelta: diff };
  }

  function isOverdueLead(lead, todayValue) {
    return nextActionStatus(lead, todayValue).status === "overdue";
  }

  function isDueTodayLead(lead, todayValue) {
    return nextActionStatus(lead, todayValue).status === "today";
  }

  function isNoNextActionLead(lead) {
    const normalized = normalizeLead(lead);
    return !isClosedLead(normalized) && (!normalized.nextAction || !normalized.nextActionDue);
  }

  function isStaleLead(lead, options) {
    const opts = options || {};
    const normalized = normalizeLead(lead);
    if (isClosedLead(normalized)) return false;
    const staleDays = opts.staleDays || STALE_DAYS;
    const age = daysSince(normalized.lastActivityAt || normalized.dateReceived, opts.today);
    return age !== null && age >= staleDays;
  }

  function isAgingQuoteLead(lead, options) {
    const opts = options || {};
    const normalized = normalizeLead(lead);
    if (!OPEN_QUOTE_STAGE_IDS.has(normalized.stageId) || isLostLead(normalized)) return false;
    const age = daysSince(normalized.quoteSentDate, opts.today);
    return age !== null && age >= (opts.agingQuoteDays || AGING_QUOTE_DAYS);
  }

  function urgencyScore(lead, options) {
    const opts = options || {};
    const normalized = normalizeLead(lead);
    if (normalized.archivedAt || isClosedLead(normalized)) return -1;
    let score = 0;
    const priorityScores = { urgent: 80, high: 45, normal: 15, low: 0 };
    score += priorityScores[normalized.priority] || 0;
    const action = nextActionStatus(normalized, opts.today);
    if (action.status === "overdue") score += 100 + Math.min(Math.abs(action.daysDelta || 0), 30);
    if (action.status === "today") score += 70;
    if (isAgingQuoteLead(normalized, opts)) score += 55;
    if (isStaleLead(normalized, opts)) score += 35;
    if (isNoNextActionLead(normalized)) score += 25;
    score += Math.min(daysInCurrentStage(normalized, opts.today), 30);
    return score;
  }

  function sortLeadsByUrgency(leads, options) {
    const opts = options || {};
    return leads.map(normalizeLead).sort((a, b) => {
      const scoreDelta = urgencyScore(b, opts) - urgencyScore(a, opts);
      if (scoreDelta) return scoreDelta;
      const stageDelta = STAGE_BY_ID[b.stageId].sort - STAGE_BY_ID[a.stageId].sort;
      if (stageDelta) return stageDelta;
      return a.customerName.localeCompare(b.customerName);
    });
  }

  function migrateLeads(input, options) {
    const opts = options || {};
    let payload = input;
    if (typeof input === "string") {
      try {
        payload = JSON.parse(input);
      } catch {
        payload = [];
      }
    }
    const sourceVersion = Number(payload && payload.version) || opts.fromVersion || 1;
    const rawLeads = Array.isArray(payload) ? payload : Array.isArray(payload && payload.leads) ? payload.leads : [];
    return {
      version: STORAGE_VERSION,
      migratedFrom: sourceVersion,
      leads: rawLeads.map((lead) => normalizeLead({
        ...lead,
        stageEnteredAt: lead.stageEnteredAt || lead.dateReceived,
        lastActivityAt: lead.lastActivityAt || lead.quoteSentDate || lead.measureCompletedDate || lead.dateReceived,
        lostDate: lead.lostDate || (lead.stageId === "lost_cancelled" ? lead.closedDate : ""),
        street: lead.street || lead.streetAddress || lead.address || lead.jobAddress,
        activityLog: lead.activityLog || lead.activities
      }))
    };
  }

  function filterLeads(leads, filters) {
    const safeFilters = filters || {};
    const query = normalizeText(safeFilters.search).toLowerCase();
    return leads.map(normalizeLead).filter((lead) => {
      if (lead.archivedAt && !safeFilters.includeArchived) return false;
      if (safeFilters.rep && safeFilters.rep !== "all" && lead.repName !== safeFilters.rep) return false;
      if (safeFilters.stage && safeFilters.stage !== "all" && lead.stageId !== safeFilters.stage) return false;
      if ((safeFilters.start || safeFilters.end) && !isWithinDateRange(lead.dateReceived, safeFilters.start, safeFilters.end)) return false;
      if (!query) return true;
      const haystack = [
        lead.externalLeadId,
        lead.customerName,
        lead.repName,
        lead.contactPhone,
        lead.contactEmail,
        lead.street,
        lead.city,
        lead.state,
        lead.zipCode,
        lead.address,
        lead.storeNumber,
        lead.productType,
        lead.source,
        lead.nextAction,
        lead.notes
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  function emptyMetric(repName) {
    return {
      repName,
      leadsAssigned: 0,
      leadsRun: 0,
      quotesSent: 0,
      totalQuotedRevenue: 0,
      openPotentialRevenue: 0,
      wonJobs: 0,
      lostJobs: 0,
      wonRevenue: 0,
      realizedRevenue: 0,
      closedOutJobs: 0,
      winRate: 0,
      averageDaysToQuote: 0,
      averageQuoteAmount: 0,
      agingOpenQuotes: 0,
      agingOpenQuoteRevenue: 0,
      overdueActions: 0,
      dueTodayActions: 0,
      staleLeads: 0,
      noNextAction: 0,
      quoteCycleDaysTotal: 0,
      quoteCycleCount: 0
    };
  }

  function calculateRepMetrics(leads, options) {
    const opts = options || {};
    const today = opts.today || todayIso();
    const metrics = new Map();

    leads.map(normalizeLead).forEach((lead) => {
      if (lead.archivedAt) return;
      const repName = lead.repName || "Unassigned";
      if (!metrics.has(repName)) metrics.set(repName, emptyMetric(repName));
      const metric = metrics.get(repName);
      const quoteAmount = normalizeNumber(lead.quoteAmount);
      const finalRevenue = normalizeNumber(lead.realizedRevenue) || quoteAmount;
      const hasQuote = quoteAmount > 0 || Boolean(lead.quoteSentDate);
      const lost = isLostLead(lead);
      const won = WON_STAGE_IDS.has(lead.stageId) || Boolean(lead.soldDate);
      const completed = isCompletedLead(lead);

      metric.leadsAssigned += 1;
      if (lead.measureCompletedDate) metric.leadsRun += 1;
      if (isOverdueLead(lead, today)) metric.overdueActions += 1;
      if (isDueTodayLead(lead, today)) metric.dueTodayActions += 1;
      if (isStaleLead(lead, { today })) metric.staleLeads += 1;
      if (isNoNextActionLead(lead)) metric.noNextAction += 1;

      if (hasQuote) {
        metric.quotesSent += lead.quoteSentDate ? 1 : 0;
        metric.totalQuotedRevenue += quoteAmount;
        metric.averageQuoteAmount += quoteAmount;
      }

      if (OPEN_QUOTE_STAGE_IDS.has(lead.stageId) && !lost) {
        metric.openPotentialRevenue += quoteAmount;
        if (isAgingQuoteLead(lead, { today })) {
          metric.agingOpenQuotes += 1;
          metric.agingOpenQuoteRevenue += quoteAmount;
        }
      }

      if (won && !lost) {
        metric.wonJobs += 1;
        metric.wonRevenue += quoteAmount;
      }

      if (completed && !lost) {
        metric.closedOutJobs += 1;
        metric.realizedRevenue += finalRevenue;
      }

      if (lost) {
        metric.lostJobs += 1;
      }

      const cycleDays = daysBetween(lead.dateReceived, lead.quoteSentDate);
      if (cycleDays !== null && cycleDays >= 0) {
        metric.quoteCycleDaysTotal += cycleDays;
        metric.quoteCycleCount += 1;
      }
    });

    const rows = Array.from(metrics.values()).map((metric) => {
      const quoteCount = metric.quotesSent || 0;
      const decided = metric.wonJobs + metric.lostJobs;
      return {
        ...metric,
        averageDaysToQuote: metric.quoteCycleCount ? metric.quoteCycleDaysTotal / metric.quoteCycleCount : 0,
        averageQuoteAmount: quoteCount ? metric.averageQuoteAmount / quoteCount : 0,
        winRate: decided ? metric.wonJobs / decided : 0
      };
    });

    rows.sort((a, b) => {
      if (b.overdueActions !== a.overdueActions) return b.overdueActions - a.overdueActions;
      if (b.realizedRevenue !== a.realizedRevenue) return b.realizedRevenue - a.realizedRevenue;
      if (b.wonRevenue !== a.wonRevenue) return b.wonRevenue - a.wonRevenue;
      return a.repName.localeCompare(b.repName);
    });

    return rows;
  }

  function calculateTeamMetrics(leads, options) {
    const repRows = calculateRepMetrics(leads, options);
    const totals = emptyMetric("Team");
    repRows.forEach((row) => {
      totals.leadsAssigned += row.leadsAssigned;
      totals.leadsRun += row.leadsRun;
      totals.quotesSent += row.quotesSent;
      totals.totalQuotedRevenue += row.totalQuotedRevenue;
      totals.openPotentialRevenue += row.openPotentialRevenue;
      totals.wonJobs += row.wonJobs;
      totals.lostJobs += row.lostJobs;
      totals.wonRevenue += row.wonRevenue;
      totals.realizedRevenue += row.realizedRevenue;
      totals.closedOutJobs += row.closedOutJobs;
      totals.agingOpenQuotes += row.agingOpenQuotes;
      totals.agingOpenQuoteRevenue += row.agingOpenQuoteRevenue;
      totals.overdueActions += row.overdueActions;
      totals.dueTodayActions += row.dueTodayActions;
      totals.staleLeads += row.staleLeads;
      totals.noNextAction += row.noNextAction;
      totals.quoteCycleDaysTotal += row.quoteCycleDaysTotal;
      totals.quoteCycleCount += row.quoteCycleCount;
    });
    const decided = totals.wonJobs + totals.lostJobs;
    totals.averageDaysToQuote = totals.quoteCycleCount ? totals.quoteCycleDaysTotal / totals.quoteCycleCount : 0;
    totals.averageQuoteAmount = totals.quotesSent ? totals.totalQuotedRevenue / totals.quotesSent : 0;
    totals.winRate = decided ? totals.wonJobs / decided : 0;
    return totals;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(normalizeNumber(value));
  }

  function formatPercent(value) {
    return `${Math.round(normalizeNumber(value) * 100)}%`;
  }

  function formatNumber(value, decimals) {
    const precision = decimals === undefined ? 0 : decimals;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    }).format(normalizeNumber(value));
  }

  function escapeCsv(value) {
    const text = String(value ?? "");
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCsv(rows, columns) {
    const header = columns.map((column) => escapeCsv(column.label)).join(",");
    const body = rows.map((row) => {
      return columns.map((column) => {
        const value = typeof column.value === "function" ? column.value(row) : row[column.key];
        return escapeCsv(value);
      }).join(",");
    });
    return [header, ...body].join("\n");
  }

  return {
    PIPELINE_STAGES,
    STAGE_BY_ID,
    STORAGE_VERSION,
    STALE_DAYS,
    AGING_QUOTE_DAYS,
    normalizeLead,
    normalizeNumber,
    normalizeText,
    normalizeDateText,
    parseDate,
    daysBetween,
    daysSince,
    daysInCurrentStage,
    nextActionStatus,
    isOverdueLead,
    isDueTodayLead,
    isNoNextActionLead,
    isStaleLead,
    isAgingQuoteLead,
    isClosedLead,
    isCompletedLead,
    urgencyScore,
    sortLeadsByUrgency,
    migrateLeads,
    filterLeads,
    calculateRepMetrics,
    calculateTeamMetrics,
    formatCurrency,
    formatPercent,
    formatNumber,
    toCsv
  };
});
