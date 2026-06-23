-- Wave 1 — analytics (analyses + children) [SPEC-000 §6; ADR 0004]
-- Header analyses -> metric_snapshots / analysis_findings / funnel_events.

create table public.analyses (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  objective           text,
  window_start        timestamptz,
  window_stop         timestamptz,
  compare_window      text,
  entities_analyzed   integer not null default 0,
  overall_verdict     text check (overall_verdict in
                        ('healthy','watch','underperforming','learning','no_data','error')),
  summary             text,
  triggered_by        text,
  raw_spec            jsonb,
  created_at          timestamptz not null default now()
);
alter table public.analyses enable row level security;
create index idx_analyses_client on public.analyses (client_id, created_at desc);

create table public.metric_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  analysis_id             uuid not null references public.analyses(id) on delete cascade,
  level                   text not null check (level in ('campaign','ad_set','ad')),
  meta_entity_id          text not null,
  impressions             bigint,
  spend_cents             bigint,
  ctr                     numeric,
  cpc_cents               integer,
  cpm_cents               integer,
  landing_page_views      bigint,
  cplpv_cents             integer,
  results                 numeric,
  cost_per_result_cents   integer,
  rankings                jsonb,
  raw                     jsonb,
  created_at              timestamptz not null default now()
);
alter table public.metric_snapshots enable row level security;
create index idx_metric_snapshots_analysis on public.metric_snapshots (analysis_id);

create table public.analysis_findings (
  id                    uuid primary key default gen_random_uuid(),
  analysis_id           uuid not null references public.analyses(id) on delete cascade,
  severity              text check (severity in ('info','low','medium','high','critical')),
  diagnosis             text,
  evidence              jsonb,
  recommended_action    text,
  recommendation_type   text,
  confidence            numeric check (confidence >= 0 and confidence <= 1),
  is_significant        boolean not null default false,
  created_at            timestamptz not null default now()
);
alter table public.analysis_findings enable row level security;
create index idx_analysis_findings_analysis on public.analysis_findings (analysis_id);

create table public.funnel_events (
  id                    uuid primary key default gen_random_uuid(),
  analysis_id           uuid not null references public.analyses(id) on delete cascade,
  level                 text not null check (level in ('account','campaign','ad_set','ad')),
  meta_entity_id        text,
  step_order            integer not null,
  event_type            text not null check (event_type in
                          ('impression','link_click','landing_page_view','view_content',
                           'add_to_cart','initiate_checkout','purchase')),
  count                 bigint,
  value_cents           bigint,
  cost_per_event_cents  integer,
  cvr_from_prev         numeric,
  cvr_from_top          numeric,
  created_at            timestamptz not null default now()
);
alter table public.funnel_events enable row level security;
create index idx_funnel_events_analysis on public.funnel_events (analysis_id, step_order);
