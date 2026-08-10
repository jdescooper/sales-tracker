# Shared Backend Setup

This CRM uses Supabase for shared lead records and email/password sign-in.

## What changes after setup

- Signed-in users see the same shared pipeline.
- Leads are stored in `public.crm_leads`.
- Rep assignment is stored as `assigned_rep_name`, so the app works before every rep is mapped to a login.
- Browser storage remains only as a local cache and import safety net.
- Reps do not delete leads in the app. Lost work is handled through the Lost / Cancelled stage and a required Lost Reason.

## Supabase steps

1. Create a Supabase project.
2. Open the Supabase SQL editor and run the SQL files in `supabase/migrations/` in order.
3. In Authentication, enable Email provider sign-in.
4. Decide whether users must confirm email before first sign-in.
5. In Project Settings, copy the Project URL and anon public key.
6. Put those values in `assets/config.js`. `assets/config.example.js` shows the expected shape.
7. Commit and deploy the repo.

The anon key is expected to be public in a browser app. Security comes from Supabase Auth plus Row Level Security policies in the migration.

## First rollout

1. Have each user create an account or sign in.
2. If a user had already entered leads before the backend existed, click `Import Local Data` once after sign-in.
3. Confirm the leadership CSV exports the same team data for an admin and a rep.

## Access model

The first version is team-wide: every authenticated user can read and update the shared pipeline. This matches the immediate need to keep everyone on the same lead board.

The schema keeps optional role and profile tables so IT can later add stricter rules, such as admin-only reports, rep-only views, or territory-based access.
