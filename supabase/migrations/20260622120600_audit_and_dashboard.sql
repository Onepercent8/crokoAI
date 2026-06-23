-- Wave 1 — audit + dashboard [SPEC-000 §6/§11]
-- operation_logs / agent_events / lp_events are append-only (prevent_mutation).
-- daily_summaries is upsertable (set_updated_at).

create table public.operation_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  entity_type text not null,
  entity_id   text,
  action      text not null check (action in ('create','update','delete','activate','pause')),
  actor       text,
  summary     text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
alter table public.operation_logs enable row level security;
create trigger trg_operation_logs_append_only
  before update or delete on public.operation_logs
  for each row execute function public.prevent_mutation();
create index idx_operation_logs_client on public.operation_logs (client_id, created_at desc);

create table public.agent_events (
  id          uuid primary key default gen_random_uuid(),
  run_id      text,
  agent_name  text,
  agent_type  text check (agent_type in ('skill','subagent','tool','system')),
  event_type  text check (event_type in ('start','step','decision','error','end')),
  tool_name   text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
alter table public.agent_events enable row level security;
create trigger trg_agent_events_append_only
  before update or delete on public.agent_events
  for each row execute function public.prevent_mutation();
create index idx_agent_events_run on public.agent_events (run_id, created_at);

create table public.daily_summaries (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  summary_date  date not null,
  summary       text,
  structured    jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, summary_date)
);
alter table public.daily_summaries enable row level security;
create trigger trg_daily_summaries_updated_at before update on public.daily_summaries
  for each row execute function public.set_updated_at();

-- NO-PII mirror of tracking events (only flags + utm + country + value).
create table public.lp_events (
  id              uuid primary key default gen_random_uuid(),
  landing_page_id uuid references public.landing_pages(id) on delete cascade,
  event_id        text not null unique,
  event_type      text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  country         text,
  value_cents     bigint,
  currency        text,
  has_email       boolean not null default false,
  has_phone       boolean not null default false,
  created_at      timestamptz not null default now()
);
alter table public.lp_events enable row level security;
create trigger trg_lp_events_append_only
  before update or delete on public.lp_events
  for each row execute function public.prevent_mutation();
create index idx_lp_events_page on public.lp_events (landing_page_id, created_at desc);
