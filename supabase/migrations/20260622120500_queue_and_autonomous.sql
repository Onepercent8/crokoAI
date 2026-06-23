-- Wave 1 — queue + autonomous mode [SPEC-000 §6/§10; ADR 0009]
-- agent_jobs is the inter-plane queue. Partial unique indexes dedup active jobs.

create table public.agent_jobs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients(id) on delete cascade,
  landing_page_id uuid references public.landing_pages(id) on delete cascade,
  skill           text not null,
  kind            text not null check (kind in
                    ('create','create_sales','activate','analyze','summarize',
                     'landing','landing_publish','landing_edit')),
  args            jsonb not null default '{}',
  status          text not null default 'pending' check (status in
                    ('pending','claimed','running','completed','failed','cancelled')),
  requested_by    text,
  claimed_by      text,
  exit_code       integer,
  result          jsonb,
  error           text,
  claimed_at      timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.agent_jobs enable row level security;
create trigger trg_agent_jobs_updated_at before update on public.agent_jobs
  for each row execute function public.set_updated_at();

-- Dedup: at most one active job per (client_id, kind) and per (landing_page_id, kind).
create unique index uq_agent_jobs_active_client_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running') and client_id is not null;
create unique index uq_agent_jobs_active_landing_kind
  on public.agent_jobs (landing_page_id, kind)
  where status in ('pending','claimed','running') and landing_page_id is not null;
-- Claim ordering / poller scan.
create index idx_agent_jobs_status_created on public.agent_jobs (status, created_at);

create table public.autonomous_watches (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid references public.clients(id) on delete cascade,
  target_kind             text not null,
  target_id               text,
  agent_job_id            uuid references public.agent_jobs(id) on delete set null,
  publish_job_id          uuid references public.agent_jobs(id) on delete set null,
  session_id              text,
  phase                   text not null default 'watching' check (phase in
                            ('watching','reviewing','notifying','done','failed')),
  last_event_ts           timestamptz,
  last_narrated_milestone text,
  claimed_by              text,
  claimed_at              timestamptz,
  result                  jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.autonomous_watches enable row level security;
create trigger trg_autonomous_watches_updated_at before update on public.autonomous_watches
  for each row execute function public.set_updated_at();
create index idx_autonomous_watches_active on public.autonomous_watches (phase, updated_at);

create table public.nexus_narrations (
  id          uuid primary key default gen_random_uuid(),
  watch_id    uuid references public.autonomous_watches(id) on delete cascade,
  session_id  text,
  text        text not null,
  kind        text not null default 'status' check (kind in ('status','opinion','system')),
  image_path  text,
  spoken_at   timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.nexus_narrations enable row level security;
create index idx_nexus_narrations_watch on public.nexus_narrations (watch_id, created_at);
