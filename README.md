# CIS Lead Pipeline

This repo is a GitHub-ready starter for the Cooper Installation Services lead-to-revenue pipeline.

The pipeline is based on the CIS Sales-to-Install Operations Manual, not the older opportunity board. It tracks inbound leads assigned to reps, Measure Work Order Numbers, scheduled measure/install dates, quote amounts, quote sent dates, won/lost outcomes, potential revenue, realized revenue, activity history, and an exportable leadership report.

## Pipeline stages

1. Intake & Measure Prep
2. Measure Management
3. Quote & Customer Decision
4. Sold / Payment Gate
5. Install & Close-Out
6. Lost / Cancelled

Micro-statuses like scheduled, contacted, ran, follow-up, and payment cleared are captured as fields or activity notes. They are not separate pipeline columns.

The app starts empty and ready for live use. Lost leads are moved through the Lost / Cancelled stage with a required reason instead of being deleted from the rep workflow.

## Run locally

This first version has no build step and no package dependencies.

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

You can also open `index.html` directly in a browser for a quick review.

## Live preview

GitHub Pages deploys the static app from the `main` branch at `/ (root)`.

Live URL:

```text
https://jdescooper.github.io/sales-tracker/
```

## Test reporting logic

```bash
node tests/reporting.test.mjs
```

## Production integration path

- Use `supabase/migrations/001_lead_pipeline.sql` as the database starting point.
- Wire the front end to Supabase Auth and the `crm_leads` table.
- Replace local browser storage in `assets/app.js` with Supabase queries.
- Keep the reporting formulas aligned with `assets/reporting.js` and the SQL function `get_crm_rep_revenue_report`.

## Handoff docs

- `docs/pipeline-model.md` explains the stage model and revenue definitions.
- `docs/github-handoff.md` explains how to publish or import this repo into GitHub.
