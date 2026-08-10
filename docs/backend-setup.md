# Shared Backend Setup

This CRM uses Supabase for shared lead records and email/password sign-in.

## What changes after setup

- Signed-in users see the same shared pipeline.
- Leads are stored in `public.crm_leads`.
- Rep assignment is stored as both `assigned_to` and `assigned_rep_name`, so permissions follow the user profile while reports keep a readable rep name.
- Browser storage remains only as a local cache and import safety net.
- Reps do not delete leads in the app. Lost work is handled through the Lost / Cancelled stage and a required Lost Reason.
- Admins create confirmed users, manage active/inactive status, remove users, and assign roles from the app's Admin page.

## Supabase steps

1. Create a Supabase project.
2. Open the Supabase SQL editor and run the SQL files in `supabase/migrations/` in order.
3. In Authentication, enable Email provider sign-in.
4. Decide whether users must confirm email before first sign-in.
5. Deploy the `admin-users` Edge Function from `supabase/functions/admin-users/`. It uses the service-role key only inside Supabase, never in the browser.
6. In Project Settings, copy the Project URL and anon public key.
7. Put those values in `assets/config.js`. `assets/config.example.js` shows the expected shape.
8. Commit and deploy the repo.

The anon key is expected to be public in a browser app. Security comes from Supabase Auth plus Row Level Security policies in the migration.

## First rollout

1. Have each user create an account or sign in.
2. If a user had already entered leads before the backend existed, click `Import Local Data` once after sign-in.
3. Confirm an admin can see the Admin page, create a confirmed user, and assign roles.
4. Confirm a rep only sees their owned lead details.
5. Confirm the leadership CSV exports organization totals for both admins and reps.

## Access model

Roles live in `public.user_roles`:

- `rep`: can create, view, and edit only leads assigned to their profile.
- `manager`: can view and edit team lead details, plus see organization report totals.
- `admin`: can view and edit team lead details, manage roles/users, and delete leads if needed.

All active users can run the organization-level report function. It returns totals by rep, not individual customer/job rows, so reps can see where they stand without seeing everyone else's details.

Removing a user from the Admin page deletes the auth user only if there is no CRM history tied to them. If they own leads or appear in CRM history, the profile is deactivated instead so reporting and audit trails remain intact.

Users created from the Admin page are created with `email_confirm: true` through the `admin-users` Edge Function. They can sign in with the temporary password immediately, even if project-level email confirmation is enabled.
