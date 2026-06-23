-- Wave 1 — lock down public schema [SPEC-000 §6/§11]
-- Deny-by-default: only service_role accesses. RLS is enabled per-table with no
-- policies; we also revoke table/sequence/function grants from anon/authenticated
-- so a direct select as anon fails with "permission denied" (not just empty rows).

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;

-- Future objects in public default to the same lockdown.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines  from anon, authenticated;
