import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from '../domain/manifest.js';
import { findCompletedManifest, writeManifest } from './manifest-writer.js';

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    run_id: 'run-1',
    idempotency_key: 'traffic-2026-06-23-abc',
    kind: 'traffic',
    status: 'completed',
    client_slug: 'cliente-exemplo',
    product_slug: 'curso-exemplo',
    daily_budget_cents: 3000,
    daily_budget_cap_cents: 5000,
    budget_was_clamped: false,
    creatives: [],
    meta_campaign_id: 'camp_1',
    meta_ad_set_id: 'set_1',
    started_at: '2026-06-23T14:00:00.000Z',
    finished_at: '2026-06-23T14:01:00.000Z',
    ...overrides,
  };
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'skill-kit-manifest-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('writeManifest', () => {
  it('writes a valid manifest under the attempts directory', async () => {
    const path = await writeManifest(baseDir, manifest(), '2026-06-23T14:00:00.000Z');
    expect(path).toContain('tentativas-geracao-de-campanhas');
    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw).run_id).toBe('run-1');
  });
});

describe('findCompletedManifest (idempotency)', () => {
  it('returns null when there is no attempts directory', async () => {
    expect(await findCompletedManifest(baseDir, 'any-key-123')).toBeNull();
  });

  it('finds a prior completed manifest by key', async () => {
    await writeManifest(baseDir, manifest(), '2026-06-23T14:00:00.000Z');
    const found = await findCompletedManifest(baseDir, 'traffic-2026-06-23-abc');
    expect(found?.meta_campaign_id).toBe('camp_1');
  });

  it('ignores a failed manifest with the same key', async () => {
    await writeManifest(
      baseDir,
      manifest({ status: 'failed', error: 'boom' }),
      '2026-06-23T14:00:00.000Z',
    );
    expect(await findCompletedManifest(baseDir, 'traffic-2026-06-23-abc')).toBeNull();
  });

  it('does not match a different key', async () => {
    await writeManifest(baseDir, manifest(), '2026-06-23T14:00:00.000Z');
    expect(await findCompletedManifest(baseDir, 'other-key-456')).toBeNull();
  });
});
