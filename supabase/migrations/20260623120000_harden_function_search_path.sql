-- Wave 1 (hardening) — pin search_path on trigger functions [SPEC-000 §11]
-- Closes Supabase advisor 0011 (function_search_path_mutable). The claim RPCs
-- already set search_path; these two shared trigger functions did not. An empty
-- search_path is safe here: both reference only plpgsql vars and pg_catalog (now()).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only; % is not allowed',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
  return null;
end;
$$;
