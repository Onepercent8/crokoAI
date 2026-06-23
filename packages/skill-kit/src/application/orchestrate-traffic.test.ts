import { describe, expect, it } from 'vitest';
import type { Manifest } from '../domain/manifest.js';
import type { CopyOutput, ImagePrompt, ProductBrief, ScrapeFacts } from '../domain/schemas.js';
import {
  orchestrateTraffic,
  type OrchestrateTrafficDeps,
  type PersistencePort,
} from './orchestrate-traffic.js';
import type {
  ClientRecord,
  GeneratedImage,
  MetaAdSetSpec,
  MetaAdsPort,
  MetaCampaignSpec,
} from './ports.js';

const BRIEF: ProductBrief = {
  client_slug: 'cliente-exemplo',
  product_slug: 'curso-exemplo',
  name: 'Curso Exemplo',
  landing_url: 'https://example.com/curso',
  price_cents: 19900,
  currency: 'BRL',
  objective: 'OUTCOME_TRAFFIC',
  call_to_action_type: 'LEARN_MORE',
};

const CLIENT: ClientRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'cliente-exemplo',
  ad_account_id: 'act_000000000000',
  facebook_page_id: '111222333',
  currency: 'BRL',
  daily_budget_cap_cents: 5000,
  default_landing_url: 'https://example.com',
};

const FACTS: ScrapeFacts = {
  product_name: 'Curso Exemplo',
  promise: 'aprenda rápido',
  pains: ['falta de tempo'],
  proof: ['46 turmas'],
  offer: 'curso completo',
};

const COPIES: CopyOutput = [
  { angle: 'autoridade', headline: 'A', primary_text: 'a' },
  { angle: 'dor', headline: 'D', primary_text: 'd' },
  { angle: 'oferta', headline: 'O', primary_text: 'o' },
];

const PROMPTS: ImagePrompt[] = [
  { angle: 'autoridade', prompt: 'p1', aspect: '1:1' },
  { angle: 'dor', prompt: 'p2', aspect: '1:1' },
  { angle: 'oferta', prompt: 'p3', aspect: '1:1' },
];

function fakeImage(angle: string): GeneratedImage {
  return {
    generated_image_id: `gi-${angle}`,
    public_url: `https://supabase.example/storage/ad-ingest/${angle}-abc.png`,
    storage_path: `ad-ingest/${angle}-abc.png`,
    width: 1024,
    height: 1024,
    model: 'gpt-image-2',
    cost_usd_estimate: 0.04,
  };
}

interface Recorder {
  campaignSpecs: MetaCampaignSpec[];
  adSetSpecs: MetaAdSetSpec[];
  creatives: number;
  ads: number;
  operationLogs: Array<{ entity_type: string; entity_id: string; action: string }>;
  upserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function makeDeps(overrides: Partial<OrchestrateTrafficDeps> = {}): {
  deps: OrchestrateTrafficDeps;
  rec: Recorder;
} {
  const rec: Recorder = {
    campaignSpecs: [],
    adSetSpecs: [],
    creatives: 0,
    ads: 0,
    operationLogs: [],
    upserts: [],
  };

  const meta: MetaAdsPort = {
    async createCampaign(spec) {
      rec.campaignSpecs.push(spec);
      return { meta_campaign_id: 'cmp_1' };
    },
    async createAdSet(spec) {
      rec.adSetSpecs.push(spec);
      return { meta_ad_set_id: 'aset_1' };
    },
    async createCreative() {
      rec.creatives += 1;
      return { meta_creative_id: `crt_${rec.creatives}` };
    },
    async createAd() {
      rec.ads += 1;
      return { meta_ad_id: `ad_${rec.ads}` };
    },
  };

  let nextId = 0;
  const persistence: PersistencePort = {
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

  const deps: OrchestrateTrafficDeps = {
    catalogue: {
      async loadBrief() {
        return BRIEF;
      },
      async loadClient() {
        return CLIENT;
      },
    },
    scrape: {
      async extract() {
        return FACTS;
      },
    },
    copy: {
      async write() {
        return COPIES;
      },
    },
    imagePrompt: {
      async generate() {
        return PROMPTS;
      },
    },
    imageGenerate: {
      async generate(input) {
        return fakeImage(input.angle);
      },
    },
    meta,
    persistence,
    async readCompletedManifest() {
      return null;
    },
    async probeActiveCampaign() {
      return false;
    },
    async writeManifest(_m, stamp) {
      return `/manifests/${stamp.replace(/[:.]/g, '-')}-traffic.json`;
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

describe('orchestrateTraffic — happy path', () => {
  it('creates the full hierarchy PAUSED and persists every level', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateTraffic(ARGS, deps);

    expect(result.status).toBe('completed');
    expect(result.reusedExisting).toBe(false);
    // Campaign always born PAUSED.
    expect(rec.campaignSpecs).toHaveLength(1);
    expect(rec.campaignSpecs[0]?.status).toBe('PAUSED');
    // 3 creatives + 3 ads.
    expect(rec.creatives).toBe(3);
    expect(rec.ads).toBe(3);
  });

  it('writes one operation_log per Meta mutation (1+1+3+3 = 8)', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateTraffic(ARGS, deps);
    expect(rec.operationLogs).toHaveLength(8);
    expect(rec.operationLogs.every((o) => o.action === 'create')).toBe(true);
    expect(rec.operationLogs.filter((o) => o.entity_type === 'campaign')).toHaveLength(1);
    expect(rec.operationLogs.filter((o) => o.entity_type === 'ad_set')).toHaveLength(1);
    expect(rec.operationLogs.filter((o) => o.entity_type === 'creative')).toHaveLength(3);
    expect(rec.operationLogs.filter((o) => o.entity_type === 'ad')).toHaveLength(3);
  });

  it('persists campaigns/ad_sets/creatives/ads/generated_images with raw_spec', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateTraffic(ARGS, deps);
    const tables = rec.upserts.map((u) => u.table);
    expect(tables.filter((t) => t === 'campaigns')).toHaveLength(1);
    expect(tables.filter((t) => t === 'ad_sets')).toHaveLength(1);
    expect(tables.filter((t) => t === 'creatives')).toHaveLength(3);
    expect(tables.filter((t) => t === 'ads')).toHaveLength(3);
    expect(tables.filter((t) => t === 'generated_images')).toHaveLength(3);
    expect(rec.upserts.every((u) => 'raw_spec' in u.row)).toBe(true);
  });

  it('ad set carries destination_type for traffic and advantage+ placements', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateTraffic(ARGS, deps);
    const adSet = rec.adSetSpecs[0];
    expect(adSet?.destination_type).toBeDefined();
    expect(adSet?.advantage_placements).toBe(true);
  });

  it('uses the public ad-ingest URL as the creative image_url (link_data.picture)', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateTraffic(ARGS, deps);
    const creatives = rec.upserts.filter((u) => u.table === 'creatives');
    for (const c of creatives) {
      expect(String(c.row.image_url)).toMatch(/^https:\/\/.*ad-ingest/);
    }
  });
});

describe('orchestrateTraffic — budget', () => {
  it('clamps an over-cap arg budget down to the cap and flags it in the manifest', async () => {
    const { deps, rec } = makeDeps();
    const result = await orchestrateTraffic({ ...ARGS, daily_budget_cents: 9999 }, deps);
    expect(result.manifest.daily_budget_cents).toBe(5000);
    expect(result.manifest.budget_was_clamped).toBe(true);
    expect(rec.campaignSpecs[0]?.daily_budget_cents).toBe(5000);
  });
});

describe('orchestrateTraffic — idempotency', () => {
  it('reuses a prior completed manifest and does NOT recreate', async () => {
    const prior: Manifest = {
      run_id: 'run-prior',
      idempotency_key: 'k',
      kind: 'traffic',
      status: 'completed',
      client_slug: 'cliente-exemplo',
      product_slug: 'curso-exemplo',
      daily_budget_cents: 3000,
      daily_budget_cap_cents: 5000,
      budget_was_clamped: false,
      creatives: [],
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
    const result = await orchestrateTraffic(ARGS, deps);
    expect(result.status).toBe('skipped');
    expect(result.reusedExisting).toBe(true);
    expect(rec.campaignSpecs).toHaveLength(0);
    expect(rec.creatives).toBe(0);
  });

  it('refuses to recreate when an active campaign exists without a manifest', async () => {
    const { deps, rec } = makeDeps({
      async probeActiveCampaign() {
        return true;
      },
    });
    await expect(orchestrateTraffic(ARGS, deps)).rejects.toThrow(/active campaign/);
    expect(rec.campaignSpecs).toHaveLength(0);
  });
});

describe('orchestrateTraffic — error paths', () => {
  it('writes a failed manifest and creates NO Meta rows on invalid args', async () => {
    let written: Manifest | null = null;
    const { deps, rec } = makeDeps({
      async writeManifest(m) {
        written = m;
        return '/manifests/failed.json';
      },
    });
    await expect(orchestrateTraffic({ client_slug: 'BAD SLUG!' }, deps)).rejects.toThrow();
    expect(rec.campaignSpecs).toHaveLength(0);
    expect(written).not.toBeNull();
    expect((written as unknown as Manifest).status).toBe('failed');
  });

  it('aborts when the copywriter omits an angle', async () => {
    const { deps, rec } = makeDeps({
      copy: {
        async write() {
          return [
            { angle: 'autoridade', headline: 'A', primary_text: 'a' },
            { angle: 'autoridade', headline: 'A2', primary_text: 'a2' },
            { angle: 'dor', headline: 'D', primary_text: 'd' },
          ] as CopyOutput;
        },
      },
    });
    await expect(orchestrateTraffic(ARGS, deps)).rejects.toThrow();
    expect(rec.campaignSpecs).toHaveLength(0);
  });
});
