-- Wave 1 — landing pages [SPEC-000 §6]
-- products -> landing_pages -> landing_page_sections. Content lives in the DB.

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  slug                text not null,
  name                text,
  brief_path          text,
  brief               jsonb,
  default_subdomain   text,
  status              text not null default 'draft',
  raw_spec            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, slug)
);
alter table public.products enable row level security;
create trigger trg_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.landing_pages (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  product_id            uuid references public.products(id) on delete restrict,
  subdomain             text not null unique,
  fqdn                  text,
  url                   text,
  content_spec          jsonb,
  tracking              jsonb,
  theme                 jsonb,
  settings              jsonb,
  checkout_url          text,
  price_cents           bigint check (price_cents >= 0),
  cart_state            text not null default 'closed' check (cart_state in ('open','closed')),
  noindex               boolean not null default true,
  ssl_status            text,
  status                text not null default 'draft'
                          check (status in ('draft','building','deployed','failed')),
  draft_status          text not null default 'empty'
                          check (draft_status in ('empty','generating','ready','editing','publishing')),
  published_snapshot    jsonb,
  repo_path             text,
  cloudflare_project_id text,
  raw_spec              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.landing_pages enable row level security;
create trigger trg_landing_pages_updated_at before update on public.landing_pages
  for each row execute function public.set_updated_at();
create index idx_landing_pages_client on public.landing_pages (client_id);
create index idx_landing_pages_product on public.landing_pages (product_id);

create table public.landing_page_sections (
  id                  uuid primary key default gen_random_uuid(),
  landing_page_id     uuid not null references public.landing_pages(id) on delete cascade,
  type                text not null,
  position            integer not null default 0,
  enabled             boolean not null default true,
  fields              jsonb,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (landing_page_id, type)
);
alter table public.landing_page_sections enable row level security;
create trigger trg_landing_page_sections_updated_at before update on public.landing_page_sections
  for each row execute function public.set_updated_at();
create index idx_lp_sections_page on public.landing_page_sections (landing_page_id, position);
