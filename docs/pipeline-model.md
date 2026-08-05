# Pipeline Model

The CRM pipeline uses the highest-level stages from the CIS Sales-to-Install Operations Manual. It is intentionally limited to six buckets so reps can actually use it every day.

## Stages

| Stage | What it means | Completion gate |
| --- | --- | --- |
| Intake & Measure Prep | Lead exists, the rep assignment is known, customer/job info is verified, and the measure path is set. | Correct customer and measure records exist, and the measure is scheduled or ready to schedule. |
| Measure Management | Measure is scheduled, completed, retrieved, and attached with usable scope and quantities. | Measure package is complete enough to quote. |
| Quote & Customer Decision | Quote is built, validated, sent, and followed. | Customer accepts, declines, communicates a longer timeline, or receives the required follow-up attempts. |
| Sold / Payment Gate | Customer accepted, sale documents are signed, and payment is being collected or verified. | Required signed documents and required payment are complete before procurement. |
| Install & Close-Out | Material, installation, approval, final payment, and closeout are tracked. | No issue or balance remains open, records reconcile, and closeout is routed or complete. |
| Lost / Cancelled | Terminal status for leads that stop before completion. | Closed with the correct reason: no contact, no longer interested, out of scope, price, cancelled, duplicate, or similar. |

## Fields instead of extra stages

These should stay as fields or activity entries, not pipeline columns:

- Contacted date
- Measure scheduled date
- Measure completed date
- Quote sent date
- Follow-up attempts
- Documents sent or signed
- Payment status
- Install scheduled date
- Closeout date

## Revenue definitions

- Total quoted revenue: sum of quote amounts for all leads with a quote amount.
- Open potential revenue: quote amount for leads currently in Quote & Customer Decision.
- Won revenue: quote amount for leads in Sold / Payment Gate or Install & Close-Out.
- Realized revenue: final revenue for leads that reach Install & Close-Out or have a closed date.
- Lost revenue: quote amount on leads in Lost / Cancelled.

## Reporting grain

Reports roll up by assigned rep. The default filter is lead received date. A production report may also add quote-sent, won, lost, and closeout date ranges for finance-grade period reporting.
