# CIS Lead CRM

A lightweight, forkable starter for the Cooper Installation Services lead-to-revenue CRM.

This version replaces the unused opportunity board with a manual-aligned inbound lead pipeline. It tracks assigned leads, quote amounts, quote sent dates, won/lost outcomes, potential revenue, realized revenue, and a leadership CSV export by rep.

## Pipeline stages

1. Intake & Measure Prep
2. Measure Management
3. Quote & Customer Decision
4. Sold / Payment Gate
5. Install & Close-Out
6. Lost / Cancelled

Micro-steps like contacted, scheduled, ran, follow-up, docs signed, payment cleared, and closeout requested are fields or notes, not pipeline columns.

## Run locally

This starter is dependency-free.

```bash
node scripts/serve.mjs
```

Then open `http://localhost:5173`.

You can also open `index.html` directly in a browser.

## Live preview

GitHub Pages deploys the static app from `main` using `.github/workflows/pages.yml`.

Live URL:

```text
https://jdescooper.github.io/sales-tracker/
```

## What is included

- `index.html`: working single-page CRM prototype with local sample data and CSV exports.
- `supabase/migrations/001_lead_pipeline.sql`: Supabase/Postgres schema, RLS policies, and rep revenue report RPC.
- `docs/pipeline-model.md`: stage definitions and reporting formulas.
- `tests/reporting.test.mjs`: sanity checks for the leadership reporting math.

## Suggested IT integration path

1. Apply the Supabase migration in a development project.
2. Wire auth to your existing profile/role system or keep the provided `profiles` and `user_roles` tables.
3. Replace browser localStorage in `index.html` with Supabase reads/writes against `crm_leads`.
4. Expose `get_crm_rep_revenue_report(start, end)` behind an admin/manager report screen.
5. Add import mapping from HDSC or your lead source into `crm_leads.external_lead_id`.
