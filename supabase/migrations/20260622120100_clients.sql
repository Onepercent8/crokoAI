-- Wave 1 — clients (account domain) [SPEC-000 §6]
-- Money in integer cents; Meta external IDs as text; RLS deny-by-default.

create table public.clients (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  ad_account_id           text not null unique,
  business_manager_id     text,
  facebook_page_id        text,
  default_landing_url     text,
  daily_budget_cap_cents  bigint not null default 5000 check (daily_budget_cap_cents >= 0),
  currency                text not null default 'BRL',
  materials_path          text,
  raw_spec                jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.clients enable row level security;

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
