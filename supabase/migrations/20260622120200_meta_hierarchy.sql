-- Wave 1 — Meta hierarchy + creatives [SPEC-000 §6]
-- generated_images <- creatives <- ads; campaigns <- ad_sets <- ads.
-- on delete: hierarchy CASCADE; ads->creatives RESTRICT; creatives->image SET NULL.

create table public.generated_images (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references public.clients(id) on delete cascade,
  storage_bucket      text not null,
  storage_path        text not null,
  width               integer,
  height              integer,
  model               text,
  prompt              text,
  aspect              text,
  cost_usd_estimate   numeric(10,4),
  raw_spec            jsonb,
  created_at          timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
alter table public.generated_images enable row level security;

create table public.creatives (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references public.clients(id) on delete cascade,
  meta_creative_id      text unique,
  headline              text,
  primary_text          text,
  description           text,
  call_to_action_type   text,
  link_url              text,
  image_url             text,
  page_id               text,
  generated_image_id    uuid references public.generated_images(id) on delete set null,
  raw_spec              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.creatives enable row level security;
create trigger trg_creatives_updated_at before update on public.creatives
  for each row execute function public.set_updated_at();

create table public.campaigns (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.clients(id) on delete cascade,
  meta_campaign_id        text unique,
  name                    text,
  objective               text not null,
  budget_mode             text check (budget_mode in ('CBO','ABO')),
  daily_budget_cents      bigint check (daily_budget_cents >= 0),
  status                  text not null default 'PAUSED',
  special_ad_categories   text[] not null default '{}',
  raw_spec                jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create trigger trg_campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();
create index idx_campaigns_client on public.campaigns (client_id);

create table public.ad_sets (
  id                      uuid primary key default gen_random_uuid(),
  campaign_id             uuid not null references public.campaigns(id) on delete cascade,
  meta_ad_set_id          text unique,
  name                    text,
  optimization_goal       text,
  billing_event           text,
  destination_type        text,
  daily_budget_cents      bigint check (daily_budget_cents >= 0),
  targeting               jsonb,
  advantage_audience      boolean not null default false,
  advantage_placements    boolean not null default false,
  status                  text not null default 'PAUSED',
  raw_spec                jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.ad_sets enable row level security;
create trigger trg_ad_sets_updated_at before update on public.ad_sets
  for each row execute function public.set_updated_at();
create index idx_ad_sets_campaign on public.ad_sets (campaign_id);

create table public.ads (
  id                  uuid primary key default gen_random_uuid(),
  ad_set_id           uuid not null references public.ad_sets(id) on delete cascade,
  creative_id         uuid references public.creatives(id) on delete restrict,
  meta_ad_id          text unique,
  name                text,
  status              text not null default 'PAUSED',
  effective_status    text,
  raw_spec            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.ads enable row level security;
create trigger trg_ads_updated_at before update on public.ads
  for each row execute function public.set_updated_at();
create index idx_ads_ad_set on public.ads (ad_set_id);
create index idx_ads_creative on public.ads (creative_id);
