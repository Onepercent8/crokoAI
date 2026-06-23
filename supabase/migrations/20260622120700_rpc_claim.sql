-- Wave 1 — atomic claim RPCs [SPEC-000 §6/§10; ADR 0009]
-- SECURITY DEFINER + FOR UPDATE SKIP LOCKED; EXECUTE revoked from anon/authenticated.

-- Claims the oldest pending job for exactly one worker. Returns NULL if none.
create or replace function public.claim_agent_job(worker text)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.agent_jobs;
begin
  select * into job
  from public.agent_jobs
  where status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.agent_jobs
  set status = 'claimed',
      claimed_by = worker,
      claimed_at = now()
  where id = job.id
  returning * into job;

  return job;
end;
$$;

-- Claims the most stale active watch for exactly one worker. Returns NULL if none.
create or replace function public.claim_autonomous_watch(worker text)
returns public.autonomous_watches
language plpgsql
security definer
set search_path = public
as $$
declare
  watch public.autonomous_watches;
begin
  select * into watch
  from public.autonomous_watches
  where phase in ('watching','reviewing','notifying')
  order by updated_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.autonomous_watches
  set claimed_by = worker,
      claimed_at = now()
  where id = watch.id
  returning * into watch;

  return watch;
end;
$$;

-- Least privilege: only the runner (service_role) may claim.
revoke all on function public.claim_agent_job(text) from public, anon, authenticated;
revoke all on function public.claim_autonomous_watch(text) from public, anon, authenticated;
grant execute on function public.claim_agent_job(text) to service_role;
grant execute on function public.claim_autonomous_watch(text) to service_role;
