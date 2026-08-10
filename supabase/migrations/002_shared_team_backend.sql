-- Align the initial CRM schema with the shared team backend used by the live app.
-- Run after 001_lead_pipeline.sql if your checkout still has the original role-limited policies.

create or replace function public.crm_can_access_lead(_lead_id uuid, _user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_leads l
    where l.id = _lead_id
      and _user_id is not null
  );
$$;

create or replace function public.get_crm_rep_revenue_report(_start date default null, _end date default null)
returns table (
  rep_id uuid,
  rep_name text,
  leads_assigned bigint,
  leads_run bigint,
  overdue_actions bigint,
  due_today_actions bigint,
  no_next_action bigint,
  stale_leads bigint,
  quotes_sent bigint,
  total_quoted_revenue numeric,
  open_potential_revenue numeric,
  won_jobs bigint,
  lost_jobs bigint,
  won_revenue numeric,
  realized_revenue numeric,
  closed_out_jobs bigint,
  win_rate numeric,
  average_days_to_quote numeric,
  aging_open_quotes bigint,
  aging_open_quote_revenue numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with visible_leads as (
    select l.*, s.revenue_state, s.is_won, s.is_lost
    from public.crm_leads l
    join public.crm_pipeline_stages s on s.id = l.stage_id
    where (_start is null or l.date_received >= _start)
      and (_end is null or l.date_received <= _end)
      and auth.uid() is not null
      and l.archived_at is null
  ),
  rolled as (
    select
      null::uuid as rep_id,
      coalesce(nullif(btrim(v.assigned_rep_name), ''), 'Unassigned') as rep_name,
      count(v.id) as leads_assigned,
      count(v.id) filter (where v.measure_completed_date is not null) as leads_run,
      count(v.id) filter (
        where nullif(btrim(v.next_action), '') is not null
          and v.next_action_due < current_date
          and not (v.stage_id = 'lost_cancelled' or v.closed_date is not null)
      ) as overdue_actions,
      count(v.id) filter (
        where nullif(btrim(v.next_action), '') is not null
          and v.next_action_due = current_date
          and not (v.stage_id = 'lost_cancelled' or v.closed_date is not null)
      ) as due_today_actions,
      count(v.id) filter (
        where not (v.stage_id = 'lost_cancelled' or v.closed_date is not null)
          and (nullif(btrim(v.next_action), '') is null or v.next_action_due is null)
      ) as no_next_action,
      count(v.id) filter (
        where not (v.stage_id = 'lost_cancelled' or v.closed_date is not null)
          and coalesce(v.last_activity_at, v.date_received) <= current_date - 14
      ) as stale_leads,
      count(v.id) filter (where v.quote_sent_date is not null) as quotes_sent,
      coalesce(sum(v.quote_amount) filter (where v.quote_amount is not null), 0) as total_quoted_revenue,
      coalesce(sum(v.quote_amount) filter (where v.revenue_state = 'open_potential'), 0) as open_potential_revenue,
      count(v.id) filter (where v.is_won) as won_jobs,
      count(v.id) filter (where v.is_lost) as lost_jobs,
      coalesce(sum(v.quote_amount) filter (where v.is_won), 0) as won_revenue,
      coalesce(sum(coalesce(v.realized_revenue, v.quote_amount)) filter (where v.closed_date is not null and not v.is_lost), 0) as realized_revenue,
      count(v.id) filter (where v.closed_date is not null and not v.is_lost) as closed_out_jobs,
      avg(v.quote_sent_date - v.date_received) filter (where v.quote_sent_date is not null) as average_days_to_quote,
      count(v.id) filter (
        where v.revenue_state = 'open_potential'
          and v.quote_sent_date is not null
          and current_date - v.quote_sent_date >= 8
      ) as aging_open_quotes,
      coalesce(sum(v.quote_amount) filter (
        where v.revenue_state = 'open_potential'
          and v.quote_sent_date is not null
          and current_date - v.quote_sent_date >= 8
      ), 0) as aging_open_quote_revenue
    from visible_leads v
    group by coalesce(nullif(btrim(v.assigned_rep_name), ''), 'Unassigned')
  )
  select
    rep_id,
    rep_name,
    leads_assigned,
    leads_run,
    overdue_actions,
    due_today_actions,
    no_next_action,
    stale_leads,
    quotes_sent,
    total_quoted_revenue,
    open_potential_revenue,
    won_jobs,
    lost_jobs,
    won_revenue,
    realized_revenue,
    closed_out_jobs,
    case when won_jobs + lost_jobs > 0 then won_jobs::numeric / (won_jobs + lost_jobs) else 0 end as win_rate,
    coalesce(average_days_to_quote, 0) as average_days_to_quote,
    aging_open_quotes,
    aging_open_quote_revenue
  from rolled
  order by realized_revenue desc, won_revenue desc, rep_name asc;
$$;

drop policy if exists "leads read assigned or manager" on public.crm_leads;
drop policy if exists "leads insert assigned or admin" on public.crm_leads;
drop policy if exists "leads update assigned or admin" on public.crm_leads;
drop policy if exists "leads read team" on public.crm_leads;
drop policy if exists "leads insert team" on public.crm_leads;
drop policy if exists "leads update team" on public.crm_leads;

create policy "leads read team" on public.crm_leads
for select to authenticated using (auth.uid() is not null);

create policy "leads insert team" on public.crm_leads
for insert to authenticated with check (auth.uid() is not null);

create policy "leads update team" on public.crm_leads
for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "lead activities insert accessible" on public.crm_lead_activities;
create policy "lead activities insert accessible" on public.crm_lead_activities
for insert to authenticated with check (
  public.crm_can_access_lead(lead_id, auth.uid())
  and user_id = auth.uid()
);

drop policy if exists "report exports admin insert" on public.crm_report_exports;
create policy "report exports admin insert" on public.crm_report_exports
for insert to authenticated with check (exported_by = auth.uid());

drop policy if exists "report exports admin read" on public.crm_report_exports;
create policy "report exports admin read" on public.crm_report_exports
for select to authenticated using (
  exported_by = auth.uid()
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'manager')
);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_leads to authenticated;
grant select, insert on public.crm_lead_activities to authenticated;
grant select on public.crm_lead_stage_history to authenticated;
grant select, insert on public.crm_report_exports to authenticated;
grant execute on function public.get_crm_rep_revenue_report(date, date) to authenticated;

revoke execute on function public.crm_touch_updated_at() from public, anon;
revoke execute on function public.crm_record_stage_history() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.crm_can_access_lead(uuid, uuid) from public, anon;
revoke execute on function public.get_crm_rep_revenue_report(date, date) from public, anon;
revoke execute on function public.crm_touch_updated_at() from authenticated;
revoke execute on function public.crm_record_stage_history() from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
