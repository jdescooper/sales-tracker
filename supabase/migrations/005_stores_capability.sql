-- Stores capability for weekly big-box retail coverage.

create table if not exists public.crm_store_roles (
  code text primary key,
  label text not null,
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_stores (
  id uuid primary key default gen_random_uuid(),
  store_number text not null unique,
  retailer text not null default 'Home Depot',
  name text not null,
  street text,
  city text,
  state text,
  zip_code text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  territory text,
  assigned_to uuid references public.profiles(user_id) on delete set null,
  assigned_rep_name text,
  volume_tier text not null default 'B' check (volume_tier in ('A', 'B', 'C')),
  annual_volume numeric,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_store_contacts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.crm_stores(id) on delete cascade,
  role_code text not null references public.crm_store_roles(code) on update cascade,
  full_name text not null,
  phone text,
  email text,
  notes text,
  is_primary boolean not null default true,
  updated_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_store_visits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.crm_stores(id) on delete cascade,
  store_number text not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  visited_at timestamptz not null default now(),
  outcome text not null default 'Visited',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_store_visit_plans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.crm_stores(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  week_start date not null,
  planned_day date,
  status text not null default 'planned' check (status in ('planned', 'visited', 'skipped')),
  visit_id uuid references public.crm_store_visits(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id, week_start)
);

create index if not exists crm_stores_assigned_to_idx on public.crm_stores (assigned_to);
create index if not exists crm_stores_store_number_idx on public.crm_stores (lower(store_number));
create index if not exists crm_stores_territory_idx on public.crm_stores (lower(territory));
create index if not exists crm_stores_city_state_idx on public.crm_stores (lower(city), lower(state));
create index if not exists crm_store_contacts_store_idx on public.crm_store_contacts (store_id);
create index if not exists crm_store_contacts_role_idx on public.crm_store_contacts (role_code);
create index if not exists crm_store_visits_store_idx on public.crm_store_visits (store_id);
create index if not exists crm_store_visits_user_date_idx on public.crm_store_visits (user_id, visited_at desc);
create index if not exists crm_store_visit_plans_user_week_idx on public.crm_store_visit_plans (user_id, week_start);

insert into public.crm_store_roles (code, label, sort_order)
values
  ('pasa', 'PASA', 10),
  ('pro_desk', 'Pro Desk', 20),
  ('pro_manager', 'Pro Manager', 30),
  ('flooring_ds', 'Flooring Department Supervisor', 40),
  ('store_manager', 'Store Manager', 50)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

create or replace function public.crm_can_access_store(_store_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_stores s
    where s.id = _store_id
      and _user_id = auth.uid()
      and public.crm_user_is_active(_user_id)
      and (
        public.crm_can_manage_team(_user_id)
        or s.assigned_to = _user_id
      )
  );
$$;

create or replace function public.crm_store_visit_rollup()
returns table (
  store_id uuid,
  last_visit_at timestamptz,
  last_visit_by uuid,
  visits_30d bigint,
  visits_all bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with visible_visits as (
    select v.*
    from public.crm_store_visits v
    where public.crm_can_access_store(v.store_id, auth.uid())
  ),
  latest as (
    select distinct on (store_id)
      store_id,
      visited_at as last_visit_at,
      user_id as last_visit_by
    from visible_visits
    order by store_id, visited_at desc
  )
  select
    s.id as store_id,
    l.last_visit_at,
    l.last_visit_by,
    count(v.id) filter (where v.visited_at >= now() - interval '30 days') as visits_30d,
    count(v.id) as visits_all
  from public.crm_stores s
  left join visible_visits v on v.store_id = s.id
  left join latest l on l.store_id = s.id
  where public.crm_can_access_store(s.id, auth.uid())
  group by s.id, l.last_visit_at, l.last_visit_by;
$$;

drop trigger if exists crm_store_roles_touch_updated_at on public.crm_store_roles;
create trigger crm_store_roles_touch_updated_at
before update on public.crm_store_roles
for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_stores_touch_updated_at on public.crm_stores;
create trigger crm_stores_touch_updated_at
before update on public.crm_stores
for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_store_contacts_touch_updated_at on public.crm_store_contacts;
create trigger crm_store_contacts_touch_updated_at
before update on public.crm_store_contacts
for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_store_visit_plans_touch_updated_at on public.crm_store_visit_plans;
create trigger crm_store_visit_plans_touch_updated_at
before update on public.crm_store_visit_plans
for each row execute function public.crm_touch_updated_at();

alter table public.crm_store_roles enable row level security;
alter table public.crm_stores enable row level security;
alter table public.crm_store_contacts enable row level security;
alter table public.crm_store_visits enable row level security;
alter table public.crm_store_visit_plans enable row level security;

drop policy if exists "store roles read authenticated" on public.crm_store_roles;
create policy "store roles read authenticated" on public.crm_store_roles
for select to authenticated using (true);

drop policy if exists "store roles admin manage" on public.crm_store_roles;
create policy "store roles admin manage" on public.crm_store_roles
to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "stores read assigned or manager" on public.crm_stores;
create policy "stores read assigned or manager" on public.crm_stores
for select to authenticated using (
  public.crm_can_manage_team(auth.uid())
  or (active and assigned_to = auth.uid())
);

drop policy if exists "stores insert assigned or manager" on public.crm_stores;
create policy "stores insert assigned or manager" on public.crm_stores
for insert to authenticated with check (
  public.crm_can_manage_team(auth.uid())
  or assigned_to = auth.uid()
);

drop policy if exists "stores update assigned or manager" on public.crm_stores;
create policy "stores update assigned or manager" on public.crm_stores
for update to authenticated
using (
  public.crm_can_manage_team(auth.uid())
  or assigned_to = auth.uid()
)
with check (
  public.crm_can_manage_team(auth.uid())
  or assigned_to = auth.uid()
);

drop policy if exists "stores delete admin only" on public.crm_stores;
create policy "stores delete admin only" on public.crm_stores
for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "store contacts read accessible" on public.crm_store_contacts;
create policy "store contacts read accessible" on public.crm_store_contacts
for select to authenticated using (public.crm_can_access_store(store_id, auth.uid()));

drop policy if exists "store contacts insert accessible" on public.crm_store_contacts;
create policy "store contacts insert accessible" on public.crm_store_contacts
for insert to authenticated with check (
  public.crm_can_access_store(store_id, auth.uid())
  and updated_by = auth.uid()
);

drop policy if exists "store contacts update accessible" on public.crm_store_contacts;
create policy "store contacts update accessible" on public.crm_store_contacts
for update to authenticated
using (public.crm_can_access_store(store_id, auth.uid()))
with check (
  public.crm_can_access_store(store_id, auth.uid())
  and updated_by = auth.uid()
);

drop policy if exists "store visits read accessible" on public.crm_store_visits;
create policy "store visits read accessible" on public.crm_store_visits
for select to authenticated using (
  public.crm_can_access_store(store_id, auth.uid())
  or user_id = auth.uid()
);

drop policy if exists "store visits insert self accessible" on public.crm_store_visits;
create policy "store visits insert self accessible" on public.crm_store_visits
for insert to authenticated with check (
  user_id = auth.uid()
  and public.crm_can_access_store(store_id, auth.uid())
);

drop policy if exists "store visits update self or manager" on public.crm_store_visits;
create policy "store visits update self or manager" on public.crm_store_visits
for update to authenticated
using (user_id = auth.uid() or public.crm_can_manage_team(auth.uid()))
with check (user_id = auth.uid() or public.crm_can_manage_team(auth.uid()));

drop policy if exists "store visits delete admin only" on public.crm_store_visits;
create policy "store visits delete admin only" on public.crm_store_visits
for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "store plans read own or manager" on public.crm_store_visit_plans;
create policy "store plans read own or manager" on public.crm_store_visit_plans
for select to authenticated using (
  user_id = auth.uid()
  or public.crm_can_manage_team(auth.uid())
);

drop policy if exists "store plans insert own accessible" on public.crm_store_visit_plans;
create policy "store plans insert own accessible" on public.crm_store_visit_plans
for insert to authenticated with check (
  user_id = auth.uid()
  and public.crm_can_access_store(store_id, auth.uid())
);

drop policy if exists "store plans update own or manager" on public.crm_store_visit_plans;
create policy "store plans update own or manager" on public.crm_store_visit_plans
for update to authenticated
using (
  user_id = auth.uid()
  or public.crm_can_manage_team(auth.uid())
)
with check (
  user_id = auth.uid()
  or public.crm_can_manage_team(auth.uid())
);

drop policy if exists "store plans delete own or admin" on public.crm_store_visit_plans;
create policy "store plans delete own or admin" on public.crm_store_visit_plans
for delete to authenticated using (
  user_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.crm_store_roles to authenticated;
grant select, insert, update, delete on public.crm_stores to authenticated;
grant select, insert, update, delete on public.crm_store_contacts to authenticated;
grant select, insert, update, delete on public.crm_store_visits to authenticated;
grant select, insert, update, delete on public.crm_store_visit_plans to authenticated;
grant execute on function public.crm_store_visit_rollup() to authenticated;

revoke execute on function public.crm_can_access_store(uuid, uuid) from public, anon;
revoke execute on function public.crm_store_visit_rollup() from public, anon;
grant execute on function public.crm_can_access_store(uuid, uuid) to authenticated;
