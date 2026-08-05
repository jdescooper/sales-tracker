import assert from 'node:assert/strict';

const stages = {
  quote_customer_decision: 'open_potential',
  sold_payment_gate: 'won',
  install_closeout: 'realized',
  lost_cancelled: 'lost'
};

const leads = [
  { rep: 'Tyler', stage: 'quote_customer_decision', quote: 10000, quoteSent: '2026-07-03' },
  { rep: 'Tyler', stage: 'sold_payment_gate', quote: 20000, quoteSent: '2026-07-06' },
  { rep: 'Mary', stage: 'install_closeout', quote: 30000, realized: 31500, quoteSent: '2026-07-04' },
  { rep: 'Mary', stage: 'lost_cancelled', quote: 5000, quoteSent: '2026-07-06' }
];

function rollup(rows) {
  const out = new Map();
  for (const lead of rows) {
    const row = out.get(lead.rep) || { leads: 0, quotes: 0, potential: 0, won: 0, realized: 0, wonJobs: 0, lostJobs: 0 };
    const state = stages[lead.stage];
    row.leads += 1;
    if (lead.quoteSent) row.quotes += 1;
    if (state === 'open_potential') row.potential += lead.quote;
    if (state === 'won' || state === 'realized') {
      row.won += lead.quote;
      row.wonJobs += 1;
    }
    if (state === 'realized') row.realized += lead.realized || lead.quote;
    if (state === 'lost') row.lostJobs += 1;
    out.set(lead.rep, row);
  }
  return out;
}

const report = rollup(leads);
assert.equal(report.get('Tyler').potential, 10000);
assert.equal(report.get('Tyler').won, 20000);
assert.equal(report.get('Mary').won, 30000);
assert.equal(report.get('Mary').realized, 31500);
assert.equal(report.get('Mary').lostJobs, 1);
console.log('reporting tests passed');
