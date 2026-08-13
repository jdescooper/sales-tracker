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

## Stores

The Stores tab tracks big-box retail coverage separately from the lead pipeline. Admins can import/update Home Depot stores by CSV using `store_number` as the dedupe key, then assign each store to a rep and territory. Store visits, weekly suggested plans, contact roles, missing contacts, and freshness are stored in Supabase.

To prepare a Home Depot directory CSV from an environment that can access the public directory pages:

```bash
npm run stores:homedepot -- --states=IL,MO --out=home-depot-stores.csv
```

Home Depot may block automated directory requests. If that happens, use the admin import panel with CSV columns such as `store_number,name,street,city,state,zip,phone,source_url,territory,assigned_rep_email,tier`.

## Shared backend and users

The app now supports Supabase Auth and a shared `crm_leads` backend. Until Supabase is configured, it clearly runs in local browser mode.

To activate shared team data:

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations/` in order in the Supabase SQL editor.
3. Enable email/password sign-in in Supabase Auth.
4. Deploy the `admin-users` Edge Function from `supabase/functions/admin-users/`.
5. Open `assets/config.js`, then fill in the project URL and public anon key. `assets/config.example.js` shows the expected shape.
6. Deploy the repo again.

After users sign in, the pipeline loads shared team leads from Supabase. If a browser already had local leads, sign in and use `Import Local Data` once to move them into the shared backend.

The public anon key is safe to use in the browser as long as Row Level Security stays enabled. Reps can only see and edit lead details they own. Managers and admins can see team lead details. All active users can see organization-level report totals without seeing other reps' customer/job details. Admin-created users are auto-confirmed by the Edge Function, so they can sign in without waiting for a verification email. The migration blocks normal app deletes; leads should be marked Lost with a reason instead.

## Handoff docs

- `docs/pipeline-model.md` explains the stage model and revenue definitions.
- `docs/backend-setup.md` explains the Supabase Auth and shared-data setup.
