-- CIS lead-to-revenue CRM schema
-- Manual-aligned pipeline for inbound leads, quotes, outcomes, potential revenue, and realized revenue.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'manager', 'rep');
  end if;
end $$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.crm_pipeline_stages (
  id text primary key,
  name text not null,
  short_name text not null,
  sort_order int not null unique,
  revenue_state text not null check (revenue_state in ('pre_quote', 'open_potential', 'won', 'realized', 'lost')),
  is_terminal boolean not null default false,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  description text,
  created_at timestamptz not null default now()
);

insert into public.crm_pipeline_stages (id, name, short_name, sort_order, revenue_state, is_terminal, is_won, is_lost, description)
values
  ('intake_measure_prep', 'Intake & Measure Prep', 'Intake', 10, 'pre_quote', false, false, false, 'Lead is assigned, customer/job details are verified, and the measure path is set.'),
  ('measure_management', 'Measure Management', 'Measure', 20, 'pre_quote', false, false, false, 'Measure is scheduled, completed, retrieved, and usable for quoting.'),
  ('quote_customer_decision', 'Quote & Customer Decision', 'Quote', 30, 'open_potential', false, false, false, 'Quote is built, sent, and followed until the customer accepts, declines, or needs more time.'),
  ('sold_payment_gate', 'Sold / Payment Gate', 'Sold', 40, 'won', false, true, false, 'Customer accepted, documents are signed, and required payment is being secured.'),
  ('install_closeout', 'Install & Close-Out', 'Close-Out', 50, 'realized', false, true, false, 'Material, install, completion approval, final payment, and closeout are being handled.'),
  ('lost_cancelled', 'Lost / Cancelled', 'Lost', 60, 'lost', true, false, true, 'Terminal bucket for no contact, declined, out of scope, cancelled, or duplicate leads.')
on conflict (id) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  sort_order = excluded.sort_order,
  revenue_state = excluded.revenue_state,
  is_terminal = excluded.is_terminal,
  is_won = excluded.is_won,
  is_lost = excluded.is_lost,
  description = excluded.description;

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  external_lead_id text not null unique,
  source text not null default 'HDSC',
  job_path text not null default 'SFI' check (job_path in ('SFI', 'F&I')),
  customer_name text not null,
  company_name text,
  customer_phone text,
  customer_email text,
  store_number text,
  product_type text,
  job_address text,
  assigned_to uuid not null references public.profiles(user_id),
  stage_id text not null references public.crm_pipeline_stages(id) default 'intake_measure_prep',
  date_received date not null default current_date,
  measure_scheduled_date date,
  measure_completed_date date,
  quote_amount numeric(12,2) check (quote_amount is null or quote_amount >= 0),
  quote_sent_date date,
  sold_date date,
  lost_date date,
  lost_reason text,
  closed_date date,
  realized_revenue numeric(12,2) check (realized_revenue is null or realized_revenue >= 0),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_required_after_quote_stage check (
    stage_id in ('intake_measure_prep', 'measure_management', 'lost_cancelled')
    or (quote_amount is not null and quote_sent_date is not null)
  ),
  constraint lost_reason_required check (stage_id <> 'lost_cancelled' or lost_reason is not null)
);

create index if not exists crm_leads_assigned_to_idx on public.crm_leads (assigned_to);
create index if not exists crm_leads_stage_idx on public.crm_leads (stage_id);
create index if not exists crm_leads_date_received_idx on public.crm_leads (date_received);
create index if not exists crm_leads_quote_sent_idx on public.crm_leads (quote_sent_date);
create index if not exists crm_leads_sold_date_idx on public.crm_leads (sold_date);
create index if not exists crm_leads_closed_date_idx on public.crm_leads (closed_date);

create table if not exists public.crm_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  activity_type text not null check (activity_type in ('note', 'call', 'email', 'follow_up', 'measure', 'quote', 'payment', 'install', 'closeout')),
  occurred_at timestamptz not null default now(),
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  from_stage_id text references public.crm_pipeline_stages(id),
  to_stage_id text not null references public.crm_pipeline_stages(id),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.crm_can_access_lead(_lead_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_leads l
    where l.id = _lead_id
      and (l.assigned_to = _user_id or public.has_role(_user_id, 'admin') or public.has_role(_user_id, 'manager'))
  );
$$;

create or replace function public.crm_record_stage_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, null, new.stage_id, auth.uid());
  elsif old.stage_id is distinct from new.stage_id then
    insert into public.crm_lead_stage_history (lead_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_touch_updated_at on public.crm_leads;
create trigger crm_leads_touch_updated_at before update on public.crm_leads for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_leads_stage_history on public.crm_leads;
create trigger crm_leads_stage_history after insert or update of stage_id on public.crm_leads for each row execute function public.crm_record_stage_history();

create or replace function public.get_crm_rep_revenue_report(_start date default null, _end date default null)
returns table (
  rep_id uuid,
  rep_name text,
  leads_assigned bigint,
  leads_run bigint,
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
language sql stable security definer set search_path = public as $$
  with visible_leads as (
    select l.*, s.revenue_state, s.is_won, s.is_lost
    from public.crm_leads l
    join public.crm_pipeline_stages s on s.id = l.stage_id
    where (_start is null or l.date_received >= _start)
      and (_end is null or l.date_received <= _end)
      and (l.assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
  ), rolled as (
    select
      p.user_id as rep_id,
      coalesce(p.full_name, p.email, 'Unassigned') as rep_name,
      count(v.id) as leads_assigned,
      count(v.id) filter (where v.measure_completed_date is not null) as leads_run,
      count(v.id) filter (where v.quote_sent_date is not null) as quotes_sent,
      coalesce(sum(v.quote_amount) filter (where v.quote_amount is not null), 0) as total_quoted_revenue,
      coalesce(sum(v.quote_amount) filter (where v.revenue_state = 'open_potential'), 0) as open_potential_revenue,
      count(v.id) filter (where v.is_won) as won_jobs,
      count(v.id) filter (where v.is_lost) as lost_jobs,
      coalesce(sum(v.quote_amount) filter (where v.is_won), 0) as won_revenue,
      coalesce(sum(coalesce(v.realized_revenue, v.quote_amount)) filter (where v.revenue_state = 'realized'), 0) as realized_revenue,
      count(v.id) filter (where v.closed_date is not null or v.revenue_state = 'realized') as closed_out_jobs,
      avg(v.quote_sent_date - v.date_received) filter (where v.quote_sent_date is not null) as average_days_to_quote,
      count(v.id) filter (where v.revenue_state = 'open_potential' and v.quote_sent_date is not null and current_date - v.quote_sent_date >= 8) as aging_open_quotes,
      coalesce(sum(v.quote_amount) filter (where v.revenue_state = 'open_potential' and v.quote_sent_date is not null and current_date - v.quote_sent_date >= 8), 0) as aging_open_quote_revenue
    from public.profiles p
    left join visible_leads v on v.assigned_to = p.user_id
    where exists (select 1 from public.user_roles ur where ur.user_id = p.user_id and ur.role = 'rep')
    group by p.user_id, p.full_name, p.email
  )
  select
    rep_id, rep_name, leads_assigned, leads_run, quotes_sent, total_quoted_revenue,
    open_potential_revenue, won_jobs, lost_jobs, won_revenue, realized_revenue,
    closed_out_jobs,
    case when won_jobs + lost_jobs > 0 then won_jobs::numeric / (won_jobs + lost_jobs) else 0 end,
    coalesce(average_days_to_quote, 0), aging_open_quotes, aging_open_quote_revenue
  from rolled
  order by realized_revenue desc, won_revenue desc, rep_name asc;
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_lead_activities enable row level security;
alter table public.crm_lead_stage_history enable row level security;

create policy "profiles read authenticated" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles admin manage" on public.profiles to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "roles read allowed" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));
create policy "roles admin manage" on public.user_roles to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "stages read authenticated" on public.crm_pipeline_stages for select to authenticated using (true);
create policy "stages admin manage" on public.crm_pipeline_stages to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy "leads read assigned or manager" on public.crm_leads for select to authenticated using (assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));
create policy "leads insert assigned or manager" on public.crm_leads for insert to authenticated with check (assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));
create policy "leads update assigned or manager" on public.crm_leads for update to authenticated using (assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) with check (assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));
create policy "leads delete admin only" on public.crm_leads for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "activities read accessible" on public.crm_lead_activities for select to authenticated using (public.crm_can_access_lead(lead_id, auth.uid()));
create policy "activities insert accessible" on public.crm_lead_activities for insert to authenticated with check (public.crm_can_access_lead(lead_id, auth.uid()) and (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
create policy "history read accessible" on public.crm_lead_stage_history for select to authenticated using (public.crm_can_access_lead(lead_id, auth.uid()));

grant usage on schema public to authenticated;
grant select on public.crm_pipeline_stages to authenticated;
grant select, insert, update on public.crm_leads to authenticated;
grant select, insert on public.crm_lead_activities to authenticated;
grant select on public.crm_lead_stage_history to authenticated;
grant execute on function public.get_crm_rep_revenue_report(date, date) to authenticated;
