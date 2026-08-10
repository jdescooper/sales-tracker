-- Add role-based CRM access for reps, managers, and admins.
-- Reps can see owned lead details. Managers/admins can see team lead details.
-- All active users can read organization-level aggregate report rows.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, email, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    true
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  insert into public.user_roles (user_id, role)
  values (new.id, 'rep')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

insert into public.user_roles (user_id, role)
select user_id, 'rep'::public.app_role
from public.profiles
where not exists (
  select 1
  from public.user_roles ur
  where ur.user_id = profiles.user_id
)
on conflict (user_id, role) do nothing;

create or replace function public.crm_user_is_active(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = _user_id
      and _user_id = auth.uid()
      and p.active
  );
$$;

create or replace function public.crm_can_manage_team(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_user_is_active(_user_id)
    and _user_id = auth.uid()
    and (
      public.has_role(_user_id, 'admin')
      or public.has_role(_user_id, 'manager')
    );
$$;

create or replace function public.crm_can_access_lead(_lead_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_leads l
    where l.id = _lead_id
      and _user_id = auth.uid()
      and public.crm_user_is_active(_user_id)
      and (
        public.crm_can_manage_team(_user_id)
        or l.assigned_to = _user_id
      )
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
security definer
set search_path = public
as $$
  with visible_leads as (
    select l.*, s.revenue_state, s.is_won, s.is_lost
    from public.crm_leads l
    join public.crm_pipeline_stages s on s.id = l.stage_id
    where (_start is null or l.date_received >= _start)
      and (_end is null or l.date_received <= _end)
      and public.crm_user_is_active(auth.uid())
      and l.archived_at is null
  ),
  rolled as (
    select
      v.assigned_to as rep_id,
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
    group by v.assigned_to, coalesce(nullif(btrim(v.assigned_rep_name), ''), 'Unassigned')
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

drop policy if exists "profiles read authenticated" on public.profiles;
drop policy if exists "profiles self read or manager" on public.profiles;
create policy "profiles self read or manager" on public.profiles
for select to authenticated using (
  public.crm_user_is_active(auth.uid())
  and (
    user_id = auth.uid()
    or public.crm_can_manage_team(auth.uid())
  )
);

drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
for update to authenticated using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
  and active
);

drop policy if exists "profiles admin manage" on public.profiles;
create policy "profiles admin manage" on public.profiles
to authenticated using (
  public.crm_user_is_active(auth.uid())
  and public.has_role(auth.uid(), 'admin')
) with check (
  public.crm_user_is_active(auth.uid())
  and public.has_role(auth.uid(), 'admin')
);

drop policy if exists "roles self read" on public.user_roles;
create policy "roles self read" on public.user_roles
for select to authenticated using (
  public.crm_user_is_active(auth.uid())
  and (
    user_id = auth.uid()
    or public.crm_can_manage_team(auth.uid())
  )
);

drop policy if exists "roles admin manage" on public.user_roles;
create policy "roles admin manage" on public.user_roles
to authenticated using (
  public.crm_user_is_active(auth.uid())
  and public.has_role(auth.uid(), 'admin')
) with check (
  public.crm_user_is_active(auth.uid())
  and public.has_role(auth.uid(), 'admin')
);

drop policy if exists "leads read assigned or manager" on public.crm_leads;
drop policy if exists "leads insert assigned or admin" on public.crm_leads;
drop policy if exists "leads update assigned or admin" on public.crm_leads;
drop policy if exists "leads read team" on public.crm_leads;
drop policy if exists "leads insert team" on public.crm_leads;
drop policy if exists "leads update team" on public.crm_leads;

create policy "leads read assigned or manager" on public.crm_leads
for select to authenticated using (public.crm_can_access_lead(id, auth.uid()));

create policy "leads insert assigned or manager" on public.crm_leads
for insert to authenticated with check (
  public.crm_user_is_active(auth.uid())
  and (
    public.crm_can_manage_team(auth.uid())
    or assigned_to = auth.uid()
  )
);

create policy "leads update assigned or manager" on public.crm_leads
for update to authenticated using (
  public.crm_can_access_lead(id, auth.uid())
) with check (
  public.crm_user_is_active(auth.uid())
  and (
    public.crm_can_manage_team(auth.uid())
    or assigned_to = auth.uid()
  )
);

drop policy if exists "leads delete admin only" on public.crm_leads;
create policy "leads delete admin only" on public.crm_leads
for delete to authenticated using (
  public.crm_user_is_active(auth.uid())
  and public.has_role(auth.uid(), 'admin')
);

drop policy if exists "lead activities follow lead select" on public.crm_lead_activities;
create policy "lead activities follow lead select" on public.crm_lead_activities
for select to authenticated using (public.crm_can_access_lead(lead_id, auth.uid()));

drop policy if exists "lead activities insert accessible" on public.crm_lead_activities;
create policy "lead activities insert accessible" on public.crm_lead_activities
for insert to authenticated with check (
  public.crm_can_access_lead(lead_id, auth.uid())
  and user_id = auth.uid()
);

drop policy if exists "lead history read accessible" on public.crm_lead_stage_history;
create policy "lead history read accessible" on public.crm_lead_stage_history
for select to authenticated using (public.crm_can_access_lead(lead_id, auth.uid()));

drop policy if exists "report exports admin insert" on public.crm_report_exports;
create policy "report exports admin insert" on public.crm_report_exports
for insert to authenticated with check (
  public.crm_user_is_active(auth.uid())
  and exported_by = auth.uid()
);

drop policy if exists "report exports admin read" on public.crm_report_exports;
create policy "report exports admin read" on public.crm_report_exports
for select to authenticated using (
  public.crm_user_is_active(auth.uid())
  and (
    exported_by = auth.uid()
    or public.crm_can_manage_team(auth.uid())
  )
);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update on public.crm_leads to authenticated;
grant execute on function public.get_crm_rep_revenue_report(date, date) to authenticated;

revoke execute on function public.crm_user_is_active(uuid) from public, anon;
revoke execute on function public.crm_can_manage_team(uuid) from public, anon;
revoke execute on function public.crm_can_access_lead(uuid, uuid) from public, anon;
revoke execute on function public.get_crm_rep_revenue_report(date, date) from public, anon;
revoke execute on function public.crm_user_is_active(uuid) from authenticated;
revoke execute on function public.crm_can_manage_team(uuid) from authenticated;
revoke execute on function public.crm_can_access_lead(uuid, uuid) from authenticated;
