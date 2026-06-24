import { describe, expect, it } from 'vitest';
import { asCents } from '../domain/money.js';
import {
  orchestrateActivation,
  type ActivationManifest,
  type OrchestrateActivationDeps,
} from './orchestrate-activation.js';
import type { ClientRecord, MetaActivationPort, MetaEntityState } from './ports.js';

const CLIENT: ClientRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'cliente-exemplo',
  ad_account_id: 'act_123',
  facebook_page_id: '111222333',
  currency: 'BRL',
  daily_budget_cap_cents: 5000,
  default_landing_url: 'https://example.com',
};

const PAUSED_ENTITY: MetaEntityState = {
  meta_entity_id: 'cmp_1',
  ad_account_id: 'act_123',
  status: 'PAUSED',
  daily_budget_cents: asCents(3000),
};

interface Recorder {
  activated: string[];
  operationLogs: Array<{ entity_type: string; entity_id: string; action: string }>;
  manifests: ActivationManifest[];
}

function makeDeps(
  overrides: {
    entity?: MetaEntityState;
    client?: ClientRecord;
    activateTo?: string;
  } = {},
): { deps: OrchestrateActivationDeps; rec: Recorder } {
  const rec: Recorder = { activated: [], operationLogs: [], manifests: [] };
  const entity = overrides.entity ?? PAUSED_ENTITY;

  const meta: MetaActivationPort = {
    async getEntity() {
      return entity;
    },
    async activateEntity(id) {
      rec.activated.push(id);
      return { status: overrides.activateTo ?? 'ACTIVE' };
    },
  };

  const deps: OrchestrateActivationDeps = {
    meta,
    async catalogueLoadClient() {
      return overrides.client ?? CLIENT;
    },
    persistence: {
      async insertOperationLog(row) {
        rec.operationLogs.push(row);
        return { id: `op-${rec.operationLogs.length}` };
      },
    },
    async writeManifest(m, stamp) {
      rec.manifests.push(m);
      return `/manifests/${stamp.replace(/[:.]/g, '-')}-activate.json`;
    },
    clock: {
      now: () => new Date('2026-06-23T12:00:00.000Z'),
      newRunId: () => 'run-test-1',
    },
  };
  return { deps, rec };
}

const ARGS = { client_slug: 'cliente-exemplo', meta_entity_id: 'cmp_1' };

describe('orchestrateActivation — happy path', () => {
  it('activates a PAUSED, within-cap, matching entity and logs action=activate', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateActivation(ARGS, deps);

    expect(result.status).toBe('completed');
    expect(result.reusedExisting).toBe(false);
    expect(rec.activated).toEqual(['cmp_1']);
    expect(rec.operationLogs).toHaveLength(1);
    expect(rec.operationLogs[0]?.action).toBe('activate');
    expect(rec.operationLogs[0]?.entity_id).toBe('cmp_1');
    expect(result.manifest.status_after).toBe('ACTIVE');
  });
});

describe('orchestrateActivation — fail-closed (abort on doubt)', () => {
  it('aborts and does NOT activate when the entity is NOT PAUSED', async () => {
    const { deps, rec } = makeDeps({
      entity: { ...PAUSED_ENTITY, status: 'WITH_ISSUES' },
    });
    await expect(orchestrateActivation(ARGS, deps)).rejects.toThrow(/must be PAUSED/);
    expect(rec.activated).toHaveLength(0);
    expect(rec.operationLogs).toHaveLength(0);
    expect(rec.manifests.at(-1)?.status).toBe('failed');
  });

  it('aborts when the budget exceeds the client cap', async () => {
    const { deps, rec } = makeDeps({
      entity: { ...PAUSED_ENTITY, daily_budget_cents: asCents(9000) },
    });
    await expect(orchestrateActivation(ARGS, deps)).rejects.toThrow(/exceeds/);
    expect(rec.activated).toHaveLength(0);
  });

  it('aborts when the entity belongs to a different ad account (cross-client)', async () => {
    const { deps, rec } = makeDeps({
      entity: { ...PAUSED_ENTITY, ad_account_id: 'act_999' },
    });
    await expect(orchestrateActivation(ARGS, deps)).rejects.toThrow(/different ad account/);
    expect(rec.activated).toHaveLength(0);
  });

  it('aborts when Meta reports the flip did not take effect', async () => {
    const { deps, rec } = makeDeps({ activateTo: 'PAUSED' });
    await expect(orchestrateActivation(ARGS, deps)).rejects.toThrow(/did not take effect/);
    // It attempted the flip but logs nothing on failure.
    expect(rec.operationLogs).toHaveLength(0);
    expect(rec.manifests.at(-1)?.status).toBe('failed');
  });

  it('aborts on invalid args (bad entity id charset) before any read', async () => {
    const { deps, rec } = makeDeps();
    await expect(
      orchestrateActivation({ client_slug: 'cliente-exemplo', meta_entity_id: 'bad id!' }, deps),
    ).rejects.toThrow();
    expect(rec.activated).toHaveLength(0);
  });
});

describe('orchestrateActivation — idempotency', () => {
  it('skips (no second flip) when the entity is already ACTIVE', async () => {
    const { deps, rec } = makeDeps({
      entity: { ...PAUSED_ENTITY, status: 'ACTIVE' },
    });
    const result = await orchestrateActivation(ARGS, deps);
    expect(result.status).toBe('skipped');
    expect(result.reusedExisting).toBe(true);
    expect(rec.activated).toHaveLength(0);
    expect(rec.operationLogs).toHaveLength(0);
  });
});
