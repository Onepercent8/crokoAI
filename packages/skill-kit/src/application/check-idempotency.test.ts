import { describe, expect, it } from 'vitest';
import type { Manifest } from '../domain/manifest.js';
import { checkIdempotency } from './check-idempotency.js';

const completed: Manifest = {
  run_id: 'run-prev',
  idempotency_key: 'traffic-2026-06-23-abc',
  kind: 'traffic',
  status: 'completed',
  client_slug: 'cliente-exemplo',
  product_slug: 'curso-exemplo',
  daily_budget_cents: 3000,
  daily_budget_cap_cents: 5000,
  budget_was_clamped: false,
  creatives: [],
  meta_campaign_id: 'camp_prev',
  meta_ad_set_id: 'set_prev',
  started_at: '2026-06-23T10:00:00.000Z',
  finished_at: '2026-06-23T10:01:00.000Z',
};

describe('checkIdempotency', () => {
  it('short-circuits when a completed manifest exists', async () => {
    const d = await checkIdempotency(
      'traffic-2026-06-23-abc',
      async () => completed,
      async () => false,
    );
    expect(d.alreadyDone).toBe(true);
    expect(d.reason).toBe('completed-manifest');
    expect(d.existing?.meta_campaign_id).toBe('camp_prev');
  });

  it('blocks when an active campaign already exists', async () => {
    const d = await checkIdempotency(
      'key-without-manifest',
      async () => null,
      async () => true,
    );
    expect(d.alreadyDone).toBe(true);
    expect(d.reason).toBe('active-campaign');
  });

  it('allows creation when there is no prior attempt', async () => {
    const d = await checkIdempotency(
      'fresh-key-123',
      async () => null,
      async () => false,
    );
    expect(d.alreadyDone).toBe(false);
    expect(d.reason).toBe('no-prior-attempt');
  });
});
