-- Wave 1 — storage buckets [SPEC-000 §6; ADR 0003]
-- creatives/nexus-review private; landing-assets/ad-ingest public.
-- ad-ingest is public because Meta fetches the creative image from it.

insert into storage.buckets (id, name, public)
values
  ('creatives',      'creatives',      false),
  ('nexus-review',   'nexus-review',   false),
  ('landing-assets', 'landing-assets', true),
  ('ad-ingest',      'ad-ingest',      true)
on conflict (id) do nothing;
