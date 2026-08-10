import assert from "node:assert/strict";
import reporting from "../assets/reporting.js";

const leads = [
  {
    id: "1",
    externalLeadId: "F1",
    customerName: "Open Quote",
    repName: "Tyler",
    street: "123 Main St",
    city: "Nashville",
    state: "TN",
    zipCode: "37201",
    stageId: "quote_customer_decision",
    dateReceived: "2026-07-01",
    stageEnteredAt: "2026-07-03",
    lastActivityAt: "2026-07-03",
    nextAction: "Call customer",
    nextActionDue: "2026-07-14",
    measureCompletedDate: "2026-07-02",
    quoteAmount: 10000,
    quoteSentDate: "2026-07-03"
  },
  {
    id: "2",
    externalLeadId: "F2",
    customerName: "Won Job",
    repName: "Tyler",
    stageId: "sold_payment_gate",
    dateReceived: "2026-07-04",
    stageEnteredAt: "2026-07-08",
    lastActivityAt: "2026-07-14",
    nextAction: "Collect payment",
    nextActionDue: "2026-07-15",
    measureCompletedDate: "2026-07-05",
    quoteAmount: 20000,
    quoteSentDate: "2026-07-06",
    soldDate: "2026-07-08",
    paymentStatus: "Pending"
  },
  {
    id: "3",
    externalLeadId: "F3",
    customerName: "Closed Job",
    repName: "Mary",
    stageId: "install_closeout",
    dateReceived: "2026-07-01",
    stageEnteredAt: "2026-07-10",
    measureCompletedDate: "2026-07-02",
    quoteAmount: 30000,
    quoteSentDate: "2026-07-04",
    soldDate: "2026-07-10",
    closedDate: "2026-07-25",
    realizedRevenue: 31500
  },
  {
    id: "4",
    externalLeadId: "F4",
    customerName: "Lost Job",
    repName: "Mary",
    stageId: "lost_cancelled",
    dateReceived: "2026-07-03",
    stageEnteredAt: "2026-07-06",
    measureCompletedDate: "2026-07-04",
    quoteAmount: 5000,
    quoteSentDate: "2026-07-06",
    lostReason: "Price",
    lostDate: "2026-07-13"
  },
  {
    id: "5",
    externalLeadId: "F5",
    customerName: "Active Install",
    repName: "Mary",
    stageId: "install_closeout",
    dateReceived: "2026-07-02",
    stageEnteredAt: "2026-07-09",
    quoteAmount: 9000,
    quoteSentDate: "2026-07-05",
    soldDate: "2026-07-09"
  }
];

const rows = reporting.calculateRepMetrics(leads, { today: "2026-07-15" });
const tyler = rows.find((row) => row.repName === "Tyler");
const mary = rows.find((row) => row.repName === "Mary");
const team = reporting.calculateTeamMetrics(leads, { today: "2026-07-15" });

assert.equal(tyler.leadsAssigned, 2);
assert.equal(tyler.quotesSent, 2);
assert.equal(tyler.openPotentialRevenue, 10000);
assert.equal(tyler.wonJobs, 1);
assert.equal(tyler.wonRevenue, 20000);
assert.equal(tyler.agingOpenQuotes, 1);
assert.equal(tyler.overdueActions, 1);
assert.equal(tyler.dueTodayActions, 1);
assert.equal(tyler.winRate, 1);

assert.equal(mary.wonJobs, 2);
assert.equal(mary.closedOutJobs, 1);
assert.equal(mary.lostJobs, 1);
assert.equal(mary.realizedRevenue, 31500);
assert.equal(mary.winRate, 2 / 3);

assert.equal(team.leadsAssigned, 5);
assert.equal(team.totalQuotedRevenue, 74000);
assert.equal(team.openPotentialRevenue, 10000);
assert.equal(team.wonRevenue, 59000);
assert.equal(team.realizedRevenue, 31500);

assert.equal(reporting.daysInCurrentStage(leads[0], "2026-07-15"), 12);
assert.equal(reporting.nextActionStatus(leads[0], "2026-07-15").status, "overdue");
assert.equal(reporting.nextActionStatus(leads[1], "2026-07-15").status, "today");
assert.equal(reporting.isOverdueLead(leads[0], "2026-07-15"), true);
assert.equal(reporting.isDueTodayLead(leads[1], "2026-07-15"), true);
assert.equal(reporting.isNoNextActionLead({ stageId: "measure_management", dateReceived: "2026-07-01" }), true);
assert.equal(reporting.isStaleLead(leads[0], { today: "2026-07-20", staleDays: 14 }), true);
assert.equal(reporting.isAgingQuoteLead(leads[0], { today: "2026-07-15" }), true);

const normalized = reporting.normalizeLead(leads[0]);
assert.equal(normalized.street, "123 Main St");
assert.equal(normalized.city, "Nashville");
assert.equal(normalized.state, "TN");
assert.equal(normalized.zipCode, "37201");
assert.equal(normalized.activityLog[0].label, "Lead received");

const urgent = reporting.sortLeadsByUrgency(leads, { today: "2026-07-15" });
assert.equal(urgent[0].externalLeadId, "F1");

const migrated = reporting.migrateLeads(JSON.stringify([
  {
    id: "legacy-1",
    externalLeadId: "L1",
    customerName: "Legacy Lead",
    repName: "Legacy Rep",
    stageId: "quote_customer_decision",
    dateReceived: "2026-07-01",
    address: "456 Legacy Ave",
    quoteSentDate: "2026-07-03",
    quoteAmount: "1200",
    activityLog: [{ at: "2026-07-03", type: "quote", label: "Quote sent" }]
  }
]), { fromVersion: 2 });
assert.equal(migrated.version, reporting.STORAGE_VERSION);
assert.equal(migrated.migratedFrom, 2);
assert.equal(migrated.leads[0].stageEnteredAt, "2026-07-01");
assert.equal(migrated.leads[0].lastActivityAt, "2026-07-03");
assert.equal(migrated.leads[0].quoteAmount, 1200);
assert.equal(migrated.leads[0].street, "456 Legacy Ave");
assert.equal(migrated.leads[0].activityLog[0].label, "Quote sent");

const csv = reporting.toCsv([{ repName: "Tyler", value: "A,B" }], [
  { label: "Rep", key: "repName" },
  { label: "Value", key: "value" }
]);
assert.equal(csv, 'Rep,Value\nTyler,"A,B"');

console.log("reporting tests passed");
