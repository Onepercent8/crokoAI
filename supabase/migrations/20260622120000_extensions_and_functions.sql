-- Wave 1 — extensions + shared trigger functions [SPEC-000 §6]
-- Idempotent helpers used across all tables.

create extension if not exists pgcrypto;

-- Bumps updated_at on every UPDATE. Attached to every table that has updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Enforces append-only contract (logs/events). Blocks UPDATE/DELETE even for
-- service_role, since BYPASSRLS means RLS alone cannot protect these tables.
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'table %.% is append-only; % is not allowed',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
  return null;
end;
$$;
