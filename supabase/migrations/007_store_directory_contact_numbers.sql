-- Additional phone fields available from the Home Depot store directory.

alter table public.crm_stores
  add column if not exists rental_phone text,
  add column if not exists pro_desk_phone text;
