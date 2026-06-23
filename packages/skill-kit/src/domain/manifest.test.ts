import { describe, expect, it } from 'vitest';
import {
  manifestFileName,
  manifestRelativePath,
  ManifestSchema,
  serializeManifest,
  type Manifest,
} from './manifest.js';

const manifest: Manifest = {
  run_id: 'run-123',
  idempotency_key: 'traffic-2026-06-23-abc',
  kind: 'traffic',
  status: 'completed',
  client_slug: 'cliente-exemplo',
  product_slug: 'curso-exemplo',
  daily_budget_cents: 3000,
  daily_budget_cap_cents: 5000,
  budget_was_clamped: false,
  creatives: [
    {
      angle: 'autoridade',
      meta_creative_id: 'cr_1',
      meta_ad_id: 'ad_1',
      generated_image_id: 'img_1',
      public_url: 'https://x/ad-ingest/a.png',
    },
  ],
  meta_campaign_id: 'camp_1',
  meta_ad_set_id: 'set_1',
  started_at: '2026-06-23T14:00:00.000Z',
  finished_at: '2026-06-23T14:01:00.000Z',
};

describe('manifest path + serialization', () => {
  it('builds a filesystem-safe file name', () => {
    const name = manifestFileName('2026-06-23T14:00:00.000Z', 'traffic');
    expect(name).toBe('2026-06-23T14-00-00-000Z-traffic.json');
    expect(name).not.toContain(':');
  });

  it('builds the relative path under the attempts directory', () => {
    expect(manifestRelativePath('2026-06-23T14:00:00.000Z', 'traffic')).toBe(
      'tentativas-geracao-de-campanhas/2026-06-23T14-00-00-000Z-traffic.json',
    );
  });

  it('rejects an invalid timestamp', () => {
    expect(() => manifestFileName('nope', 'traffic')).toThrow();
  });

  it('serializes valid manifests to pretty JSON', () => {
    const out = serializeManifest(manifest);
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out).run_id).toBe('run-123');
  });

  it('rejects a manifest with a too-short idempotency key', () => {
    expect(() => ManifestSchema.parse({ ...manifest, idempotency_key: 'x' })).toThrow();
  });
});
