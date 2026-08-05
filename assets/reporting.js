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
      revenueState: "realized",
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

  const STAGE_BY_ID = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage.id] = stage;
    return acc;
  }, {});

  const OPEN_QUOTE_STAGE_IDS = new Set(["quote_customer_decision"]);
  const WON_STAGE_IDS = new Set(["sold_payment_gate", "install_closeout"]);
  const REALIZED_STAGE_IDS = new Set(["install_closeout"]);
  const LOST_STAGE_IDS = new Set(["lost_cancelled"]);

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeLead(lead) {
    const stageId = STAGE_BY_ID[lead.stageId] ? lead.stageId : PIPELINE_STAGES[0].id;
    return {
      id: normalizeText(lead.id),
      externalLeadId: normalizeText(lead.externalLeadId),
      source: normalizeText(lead.source) || "HDSC",
      jobPath: normalizeText(lead.jobPath) || "SFI",
      customerName: normalizeText(lead.customerName),
      repName: normalizeText(lead.repName) || "Unassigned",
      address: normalizeText(lead.address),
      storeNumber: normalizeText(lead.storeNumber),
      productType: normalizeText(lead.productType),
      stageId,
      dateReceived: normalizeText(lead.dateReceived),
      measureCompletedDate: normalizeText(lead.measureCompletedDate),
      quoteAmount: normalizeNumber(lead.quoteAmount),
      quoteSentDate: normalizeText(lead.quoteSentDate),
      soldDate: normalizeText(lead.soldDate),
      closedDate: normalizeText(lead.closedDate),
      realizedRevenue: normalizeNumber(lead.realizedRevenue),
      lostReason: normalizeText(lead.lostReason),
      notes: normalizeText(lead.notes)
    };
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(startValue, endValue) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end) return null;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  function daysSince(value, todayValue) {
    const today = parseDate(todayValue) || new Date();
    const date = parseDate(value);
    if (!date) return null;
    return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
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

  function filterLeads(leads, filters) {
    const safeFilters = filters || {};
    const query = normalizeText(safeFilters.search).toLowerCase();
    return leads.map(normalizeLead).filter((lead) => {
      if (safeFilters.rep && safeFilters.rep !== "all" && lead.repName !== safeFilters.rep) return false;
      if (safeFilters.stage && safeFilters.stage !== "all" && lead.stageId !== safeFilters.stage) return false;
      if ((safeFilters.start || safeFilters.end) && !isWithinDateRange(lead.dateReceived, safeFilters.start, safeFilters.end)) return false;
      if (!query) return true;
      const haystack = [
        lead.externalLeadId,
        lead.customerName,
        lead.repName,
        lead.address,
        lead.storeNumber,
        lead.productType,
        lead.source,
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
      agingOpenQuotes: 0,
      agingOpenQuoteRevenue: 0,
      quoteCycleDaysTotal: 0,
      quoteCycleCount: 0,
      averageDaysToQuote: 0,
      averageQuoteAmount: 0,
      winRate: 0
    };
  }

  function calculateRepMetrics(leads, options) {
    const opts = options || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const metrics = new Map();

    leads.map(normalizeLead).forEach((lead) => {
      const repName = lead.repName || "Unassigned";
      if (!metrics.has(repName)) metrics.set(repName, emptyMetric(repName));
      const metric = metrics.get(repName);
      const quoteAmount = normalizeNumber(lead.quoteAmount);
      const finalRevenue = normalizeNumber(lead.realizedRevenue) || quoteAmount;
      const hasQuote = quoteAmount > 0 || Boolean(lead.quoteSentDate);
      const isLost = LOST_STAGE_IDS.has(lead.stageId) || Boolean(lead.lostDate);
      const isWon = WON_STAGE_IDS.has(lead.stageId) || Boolean(lead.soldDate);
      const isRealized = REALIZED_STAGE_IDS.has(lead.stageId) || Boolean(lead.closedDate);

      metric.leadsAssigned += 1;
      if (lead.measureCompletedDate) metric.leadsRun += 1;

      if (hasQuote) {
        metric.quotesSent += lead.quoteSentDate ? 1 : 0;
        metric.totalQuotedRevenue += quoteAmount;
        metric.averageQuoteAmount += quoteAmount;
      }

      if (OPEN_QUOTE_STAGE_IDS.has(lead.stageId) && !isLost) {
        metric.openPotentialRevenue += quoteAmount;
        const age = daysSince(lead.quoteSentDate, today);
        if (age !== null && age >= 8) {
          metric.agingOpenQuotes += 1;
          metric.agingOpenQuoteRevenue += quoteAmount;
        }
      }

      if (isWon && !isLost) {
        metric.wonJobs += 1;
        metric.wonRevenue += quoteAmount;
      }

      if (isRealized && !isLost) {
        metric.closedOutJobs += 1;
        metric.realizedRevenue += finalRevenue;
      }

      if (isLost) {
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
    normalizeLead,
    normalizeNumber,
    filterLeads,
    calculateRepMetrics,
    calculateTeamMetrics,
    daysBetween,
    daysSince,
    formatCurrency,
    formatPercent,
    formatNumber,
    toCsv
  };
});

