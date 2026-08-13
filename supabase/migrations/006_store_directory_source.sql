-- Store directory fields used by public retailer directory imports.

alter table public.crm_stores
  add column if not exists phone text,
  add column if not exists source_url text;

create index if not exists crm_stores_source_url_idx on public.crm_stores (source_url);
