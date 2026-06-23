-- Wave 1 gate verification [SPEC-000 §8 Onda 1]
-- Run against the local DB after `supabase db reset`, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-wave1.sql
-- Each block raises an exception if the invariant is violated.

\set ON_ERROR_STOP on

-- 1) Seed present.
do $$
begin
  if not exists (select 1 from public.clients where slug = 'cliente-exemplo') then
    raise exception 'GATE FAIL: seed cliente-exemplo missing';
  end if;
  raise notice 'OK: seed cliente-exemplo present';
end $$;

-- 2) RLS enabled on every public table (deny-by-default).
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
  if bad is not null then
    raise exception 'GATE FAIL: RLS disabled on: %', bad;
  end if;
  raise notice 'OK: RLS enabled on all public tables';
end $$;

-- 3) Atomic claim: insert a job, claim it, assert it became claimed.
do $$
declare
  cid uuid;
  claimed public.agent_jobs;
begin
  select id into cid from public.clients where slug = 'cliente-exemplo';
  insert into public.agent_jobs (client_id, skill, kind, status)
  values (cid, 'verify-wave1', 'analyze', 'pending');

  claimed := public.claim_agent_job('verify-worker');
  if claimed.id is null or claimed.status <> 'claimed'
     or claimed.claimed_by <> 'verify-worker' then
    raise exception 'GATE FAIL: claim_agent_job did not claim atomically';
  end if;
  raise notice 'OK: claim_agent_job atomic';

  -- cleanup the test job
  delete from public.agent_jobs where id = claimed.id;
end $$;

-- 4) Partial unique index blocks a 2nd active job for same (client_id, kind).
do $$
declare cid uuid; dup_blocked boolean := false;
begin
  select id into cid from public.clients where slug = 'cliente-exemplo';
  insert into public.agent_jobs (client_id, skill, kind, status)
  values (cid, 'verify-dup', 'create', 'pending');
  begin
    insert into public.agent_jobs (client_id, skill, kind, status)
    values (cid, 'verify-dup-2', 'create', 'pending');
  exception when unique_violation then
    dup_blocked := true;
  end;
  if not dup_blocked then
    raise exception 'GATE FAIL: duplicate active job not blocked';
  end if;
  raise notice 'OK: partial unique index blocks duplicate active job';
  delete from public.agent_jobs where client_id = cid and kind = 'create';
end $$;

-- 5) Append-only: UPDATE on a log table is rejected.
do $$
declare rejected boolean := false; lid uuid;
begin
  insert into public.operation_logs (entity_type, action, summary)
  values ('test', 'create', 'verify-wave1') returning id into lid;
  begin
    update public.operation_logs set summary = 'mutated' where id = lid;
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'GATE FAIL: append-only UPDATE was allowed';
  end if;
  raise notice 'OK: append-only UPDATE rejected';
end $$;

-- 6) Storage buckets created with correct visibility.
do $$
begin
  if (select count(*) from storage.buckets
      where id in ('creatives','nexus-review','landing-assets','ad-ingest')) <> 4 then
    raise exception 'GATE FAIL: storage buckets missing';
  end if;
  if not (select public from storage.buckets where id = 'ad-ingest') then
    raise exception 'GATE FAIL: ad-ingest must be public';
  end if;
  if (select public from storage.buckets where id = 'creatives') then
    raise exception 'GATE FAIL: creatives must be private';
  end if;
  raise notice 'OK: storage buckets present with correct visibility';
end $$;

\echo 'WAVE 1 GATE: all SQL invariants passed'
