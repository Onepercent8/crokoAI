-- Wave 1 — seed [SPEC-000 §6]
-- One example client. Keeps template placeholders (cliente-exemplo / example.com).
-- Applied automatically after migrations by `supabase db reset` (config.toml [db.seed]).

insert into public.clients (
  slug, name, ad_account_id, currency, daily_budget_cap_cents,
  default_landing_url, materials_path
)
values (
  'cliente-exemplo',
  'Cliente Exemplo',
  'act_000000000000',
  'BRL',
  5000,
  'https://example.com',
  '.claude/materiais-das-empresas/cliente-exemplo'
)
on conflict (slug) do nothing;
