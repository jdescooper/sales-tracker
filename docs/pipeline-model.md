# Pipeline Model

The CRM pipeline uses the highest-level stages from the CIS Sales-to-Install Operations Manual.

## Stages

| Stage | What it means | Completion gate |
| --- | --- | --- |
| Intake & Measure Prep | Lead exists, assigned rep is known, customer/job info is verified, and the measure path is set. | Correct customer and measure records exist, and the measure is scheduled or ready to schedule. |
| Measure Management | Measure is scheduled, completed, retrieved, and attached with usable scope and quantities. | Measure package is complete enough to quote. |
| Quote & Customer Decision | Quote is built, validated, sent, and followed. | Customer accepts, declines, communicates a longer timeline, or receives the required follow-up attempts. |
| Sold / Payment Gate | Customer accepted, sale docs are signed, and payment is being collected or verified. | Required signed documents and required payment are complete before procurement. |
| Install & Close-Out | Material, installation, approval, final payment, and closeout are tracked. | No issue or balance remains open, records reconcile, and closeout is routed or complete. |
| Lost / Cancelled | Terminal status for leads that stop before completion. | Closed with the correct reason: no contact, no longer interested, out of scope, price, cancelled, duplicate, or similar. |

## Fields instead of extra stages

The following should stay as fields or activity entries, not columns:

- Measure Work Order Number
- Phone number
- Email address
- Street, city, state, and ZIP code
- Contacted date
- Measure scheduled date
- Measure completed date
- Quote sent date
- Follow-up attempts
- Docs sent or signed
- Payment status
- Install scheduled date
- Closeout date
- Activity trail entries

This keeps the board simple while preserving the audit trail needed for leadership reporting.

## Stage movement requirements

| Move to stage | Required before the move commits |
| --- | --- |
| Intake & Measure Prep | Measure Work Order Number, customer, assigned rep, and received date are verified. |
| Measure Management | Measure appointment is scheduled and Measure Scheduled date is entered. |
| Quote & Customer Decision | Quote amount and Quote Sent date are entered. |
| Sold / Payment Gate | Quote amount, Quote Sent date, Won/Accepted date, and payment status are entered. |
| Install & Close-Out | Quote amount, Quote Sent date, Won/Accepted date, Install Scheduled date, and payment status are entered. Closed Date is set only when close-out is complete. |
| Lost / Cancelled | Lost reason and Lost Date are entered. This replaces deletion for normal sales-rep cleanup. |

Lost and completed leads should move to the Closed view instead of staying in the daily work dashboard. They remain available for leadership reports and exports without cluttering the active pipeline.

## Stage age benchmarks

| Stage | Benchmark | Card signal |
| --- | --- | --- |
| Intake & Measure Prep | 3 days | Green before day 3, yellow on day 3, red after day 3. |
| Measure Management | 3 days | Green before day 3, yellow on day 3, red after day 3. |
| Quote & Customer Decision | 8 days | Green before day 8, yellow on day 8, red after day 8. |
| Sold / Payment Gate | 3 days | Green before day 3, yellow on day 3, red after day 3. |
| Install & Close-Out | 14 days | Green before day 14, yellow on day 14, red after day 14. |

## Revenue definitions

- Total quoted revenue: sum of quote amounts for all leads with a quote amount.
- Open potential revenue: quote amount for leads currently in Quote & Customer Decision.
- Won revenue: quote amount for leads in Sold / Payment Gate or Install & Close-Out.
- Realized revenue: final revenue on won leads only after a close-out date is set.
- Lost revenue: quote amount on leads in Lost / Cancelled.

## Reporting grain

Reports roll up by assigned rep. The first screen in this prototype filters by lead received date. A production report may also add quote-sent, won, lost, and closeout date ranges for finance-grade period reporting.
