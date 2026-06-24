import { describe, expect, it } from 'vitest';
import {
  orchestrateSales,
  type OrchestrateSalesDeps,
  type SalesManifest,
  type SalesPersistencePort,
} from './orchestrate-sales.js';
import type {
  MetaSalesAdSetSpec,
  MetaSalesCampaignSpec,
  MetaSalesPort,
  SalesClientRecord,
  WinningCreative,
} from './ports.js';

const CLIENT: SalesClientRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'cliente-exemplo',
  ad_account_id: 'act_123',
  facebook_page_id: '111222333',
  currency: 'BRL',
  daily_budget_cap_cents: 5000,
  default_landing_url: 'https://example.com',
  pixel_id: 'px_999',
};

const WINNERS: WinningCreative[] = [
  { meta_creative_id: 'crt_a', purchases: 3, purchase_value_cents: 30000 },
  { meta_creative_id: 'crt_b', purchases: 10, purchase_value_cents: 90000 },
  { meta_creative_id: 'crt_c', purchases: 7, purchase_value_cents: 50000 },
  { meta_creative_id: 'crt_d', purchases: 0, purchase_value_cents: 0 },
];

interface Recorder {
  campaignSpecs: MetaSalesCampaignSpec[];
  adSetSpecs: MetaSalesAdSetSpec[];
  ads: number;
  reusedCreativeIds: string[];
  operationLogs: Array<{ entity_type: string; entity_id: string; action: string }>;
  upserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function makeDeps(overrides: Partial<OrchestrateSalesDeps> = {}): {
  deps: OrchestrateSalesDeps;
  rec: Recorder;
} {
  const rec: Recorder = {
    campaignSpecs: [],
    adSetSpecs: [],
    ads: 0,
    reusedCreativeIds: [],
    operationLogs: [],
    upserts: [],
  };

  const meta: MetaSalesPort = {
    async listWinningCreatives() {
      return WINNERS;
    },
    async createSalesCampaign(spec) {
      rec.campaignSpecs.push(spec);
      return { meta_campaign_id: 'cmp_sales_1' };
    },
    async createSalesAdSet(spec) {
      rec.adSetSpecs.push(spec);
      return { meta_ad_set_id: 'aset_sales_1' };
    },
    async createSalesAd(spec) {
      rec.ads += 1;
      rec.reusedCreativeIds.push(spec.meta_creative_id);
      return { meta_ad_id: `ad_${rec.ads}` };
    },
  };

  let nextId = 0;
  const persistence: SalesPersistencePort = {
    async upsert(table, row) {
      rec.upserts.push({ table, row });
      nextId += 1;
      return { ...row, id: `${table}-${nextId}` };
    },
    async insertOperationLog(row) {
      rec.operationLogs.push(row);
      return { id: `op-${rec.operationLogs.length}` };
    },
  };

  const deps: OrchestrateSalesDeps = {
    meta,
    async catalogueLoadSalesClient() {
      return CLIENT;
    },
    persistence,
    async readCompletedManifest() {
      return null;
    },
    async probeActiveSalesCampaign() {
      return false;
    },
    async writeManifest(_m, stamp) {
      return `/manifests/${stamp.replace(/[:.]/g, '-')}-sales.json`;
    },
    clock: {
      now: () => new Date('2026-06-23T12:00:00.000Z'),
      newRunId: () => 'run-test-1',
    },
    ...overrides,
  };
  return { deps, rec };
}

const ARGS = { client_slug: 'cliente-exemplo', product_slug: 'curso-exemplo' };

describe('orchestrateSales — happy path', () => {
  it('creates a PAUSED OUTCOME_SALES campaign reusing the top-N winners', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateSales(ARGS, deps);

    expect(result.status).toBe('completed');
    expect(rec.campaignSpecs).toHaveLength(1);
    expect(rec.campaignSpecs[0]?.objective).toBe('OUTCOME_SALES');
    expect(rec.campaignSpecs[0]?.status).toBe('PAUSED');
    // top-3 by purchases: crt_b (10), crt_c (7), crt_a (3); crt_d (0) excluded.
    expect(rec.reusedCreativeIds).toEqual(['crt_b', 'crt_c', 'crt_a']);
    expect(rec.ads).toBe(3);
  });

  it('OMITS destination_type on the sales ad set (Meta v25 gotcha)', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateSales(ARGS, deps);
    const adSet = rec.adSetSpecs[0] as MetaSalesAdSetSpec;
    expect('destination_type' in adSet).toBe(false);
    expect(adSet.custom_event_type).toBe('PURCHASE');
    expect(adSet.pixel_id).toBe('px_999');
    // The persisted ad_sets row also omits destination_type.
    const adSetRow = rec.upserts.find((u) => u.table === 'ad_sets');
    expect(adSetRow && 'destination_type' in adSetRow.row).toBe(false);
  });

  it('writes one operation_log per Meta mutation (1 campaign + 1 ad set + 3 ads)', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateSales(ARGS, deps);
    expect(rec.operationLogs).toHaveLength(5);
    expect(rec.operationLogs.every((o) => o.action === 'create')).toBe(true);
    expect(rec.operationLogs.filter((o) => o.entity_type === 'ad')).toHaveLength(3);
  });

  it('persists campaigns/ad_sets/ads with raw_spec each', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateSales(ARGS, deps);
    const tables = rec.upserts.map((u) => u.table);
    expect(tables.filter((t) => t === 'campaigns')).toHaveLength(1);
    expect(tables.filter((t) => t === 'ad_sets')).toHaveLength(1);
    expect(tables.filter((t) => t === 'ads')).toHaveLength(3);
    expect(rec.upserts.every((u) => 'raw_spec' in u.row)).toBe(true);
  });

  it('respects top_n=1 (single winner)', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateSales({ ...ARGS, top_n: 1 }, deps);
    expect(rec.reusedCreativeIds).toEqual(['crt_b']);
    expect(result.manifest.reused_creatives).toHaveLength(1);
  });
});

describe('orchestrateSales — budget', () => {
  it('clamps an over-cap arg budget down to the cap and flags it', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateSales({ ...ARGS, daily_budget_cents: 9999 }, deps);
    expect(result.manifest.daily_budget_cents).toBe(5000);
    expect(result.manifest.budget_was_clamped).toBe(true);
    expect(rec.campaignSpecs[0]?.daily_budget_cents).toBe(5000);
  });
});

describe('orchestrateSales — error paths', () => {
  it('aborts when no winning creative has purchases (no blind spend)', async () => {
    const { deps, rec } = makeDeps({
      meta: {
        async listWinningCreatives() {
          return [{ meta_creative_id: 'crt_z', purchases: 0, purchase_value_cents: 0 }];
        },
        async createSalesCampaign(spec) {
          rec.campaignSpecs.push(spec);
          return { meta_campaign_id: 'x' };
        },
        async createSalesAdSet(spec) {
          rec.adSetSpecs.push(spec);
          return { meta_ad_set_id: 'x' };
        },
        async createSalesAd() {
          rec.ads += 1;
          return { meta_ad_id: 'x' };
        },
      },
    });
    await expect(orchestrateSales(ARGS, deps)).rejects.toThrow(/no winning creative/);
    expect(rec.campaignSpecs).toHaveLength(0);
  });

  it('writes a failed manifest and creates NO Meta rows on invalid args', async () => {
    let written: SalesManifest | null = null;
    const { deps, rec } = makeDeps({
      async writeManifest(m) {
        written = m;
        return '/manifests/failed.json';
      },
    });
    await expect(orchestrateSales({ client_slug: 'BAD SLUG!' }, deps)).rejects.toThrow();
    expect(rec.campaignSpecs).toHaveLength(0);
    expect((written as unknown as SalesManifest).status).toBe('failed');
  });
});

describe('orchestrateSales — idempotency', () => {
  it('reuses a prior completed manifest and does NOT recreate', async () => {
    const prior: SalesManifest = {
      run_id: 'run-prior',
      idempotency_key: 'k-prior-1234',
      kind: 'sales',
      client_slug: 'cliente-exemplo',
      product_slug: 'curso-exemplo',
      status: 'completed',
      daily_budget_cents: 3000,
      daily_budget_cap_cents: 5000,
      budget_was_clamped: false,
      window_days: 14,
      top_n: 3,
      reused_creatives: [],
      meta_campaign_id: 'cmp_prior',
      meta_ad_set_id: 'aset_prior',
      started_at: '2026-06-23T00:00:00.000Z',
      finished_at: '2026-06-23T00:01:00.000Z',
    };
    const { deps, rec } = makeDeps({
      async readCompletedManifest() {
        return prior;
      },
    });
    const result = await orchestrateSales(ARGS, deps);
    expect(result.status).toBe('skipped');
    expect(result.reusedExisting).toBe(true);
    expect(rec.campaignSpecs).toHaveLength(0);
    expect(rec.ads).toBe(0);
  });

  it('refuses to recreate when an active sales campaign exists without a manifest', async () => {
    const { deps, rec } = makeDeps({
      async probeActiveSalesCampaign() {
        return true;
      },
    });
    await expect(orchestrateSales(ARGS, deps)).rejects.toThrow(/active sales campaign/);
    expect(rec.campaignSpecs).toHaveLength(0);
  });
});
