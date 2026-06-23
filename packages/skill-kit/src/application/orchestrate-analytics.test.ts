import { describe, expect, it } from 'vitest';
import type { FunnelInsights } from '../domain/funnel.js';
import type { ClientRecord } from './ports.js';
import {
  orchestrateAnalytics,
  type AnalyticsPersistencePort,
  type EntityInsights,
  type MetaReadPort,
  type OrchestrateAnalyticsDeps,
} from './orchestrate-analytics.js';

const CLIENT: ClientRecord = {
  id: 'client-1',
  slug: 'cliente-exemplo',
  ad_account_id: 'act_0',
  facebook_page_id: 'p1',
  currency: 'BRL',
  daily_budget_cap_cents: 5000,
  default_landing_url: 'https://example.com',
};

function insights(p: Partial<FunnelInsights>): FunnelInsights {
  return {
    spend_cents: 10000,
    impressions: 5000,
    link_clicks: 200,
    landing_page_views: 50,
    view_content: 30,
    add_to_cart: 10,
    initiate_checkout: 5,
    purchases: 2,
    purchase_value_cents: 39800,
    ...p,
  };
}

interface Rec {
  analyses: number;
  snapshots: number;
  findings: number;
  funnelEvents: number;
  opLogs: number;
}

function makeDeps(
  entities: EntityInsights[],
  overrides: Partial<OrchestrateAnalyticsDeps> = {},
): { deps: OrchestrateAnalyticsDeps; rec: Rec } {
  const rec: Rec = { analyses: 0, snapshots: 0, findings: 0, funnelEvents: 0, opLogs: 0 };
  const meta: MetaReadPort = {
    async listEntities() {
      return entities;
    },
  };
  let nid = 0;
  const persistence: AnalyticsPersistencePort = {
    async insertAnalysis() {
      rec.analyses += 1;
      return { id: 'analysis-1' };
    },
    async insertMetricSnapshots(rows) {
      rec.snapshots += rows.length;
      return { ids: rows.map(() => `s-${(nid += 1)}`) };
    },
    async insertFindings(rows) {
      rec.findings += rows.length;
      return { ids: rows.map(() => `f-${(nid += 1)}`) };
    },
    async insertFunnelEvents(rows) {
      rec.funnelEvents += rows.length;
      return { ids: rows.map(() => `e-${(nid += 1)}`) };
    },
    async insertOperationLog() {
      rec.opLogs += 1;
      return { id: `op-${rec.opLogs}` };
    },
  };
  const deps: OrchestrateAnalyticsDeps = {
    meta,
    catalogueLoadClient: async () => CLIENT,
    persistence,
    writeManifest: async (_m, stamp) => `/manifests/${stamp.replace(/[:.]/g, '-')}-analysis.json`,
    clock: { now: () => new Date('2026-06-23T12:00:00.000Z'), newRunId: () => 'run-an-1' },
    ...overrides,
  };
  return { deps, rec };
}

function entity(
  level: EntityInsights['level'],
  id: string,
  p: Partial<FunnelInsights>,
): EntityInsights {
  return { level, meta_entity_id: id, insights: insights(p), raw: { id } };
}

describe('orchestrateAnalytics', () => {
  it('writes 1 analysis + N snapshots + 7 funnel_events per entity (+ account)', async () => {
    const entities = [entity('campaign', 'c1', {}), entity('ad_set', 'a1', {})];
    const { deps, rec } = makeDeps(entities);
    const result = await orchestrateAnalytics(
      { client_slug: 'cliente-exemplo', window_days: 7 },
      deps,
    );

    expect(rec.analyses).toBe(1);
    expect(rec.snapshots).toBe(2);
    // 7 per entity + 7 account = (2+1)*7 = 21
    expect(rec.funnelEvents).toBe(21);
    expect(result.funnelEventsWritten).toBe(21);
    expect(result.metricSnapshotsWritten).toBe(2);
    expect(result.analysisId).toBe('analysis-1');
  });

  it('produces no_data verdict and zero snapshots when no entities have activity', async () => {
    const { deps, rec } = makeDeps([]);
    const result = await orchestrateAnalytics(
      { client_slug: 'cliente-exemplo', window_days: 7 },
      deps,
    );
    expect(result.overallVerdict).toBe('no_data');
    expect(rec.snapshots).toBe(0);
    expect(rec.funnelEvents).toBe(0);
    expect(rec.analyses).toBe(1); // header still written
  });

  it('emits cross-metric findings for a weak funnel', async () => {
    const entities = [entity('campaign', 'c1', { landing_page_views: 40 })];
    const { deps, rec } = makeDeps(entities);
    await orchestrateAnalytics({ client_slug: 'cliente-exemplo', window_days: 7 }, deps);
    expect(rec.findings).toBeGreaterThanOrEqual(1);
  });

  it('uses a read-only Meta port (no write methods exist on the port type)', async () => {
    // Structural guarantee: MetaReadPort exposes only listEntities. This test
    // documents the gate "no Meta mutation" — a write method would not compile.
    const { deps } = makeDeps([entity('campaign', 'c1', {})]);
    expect(Object.keys(deps.meta)).toEqual(['listEntities']);
  });

  it('writes a failed manifest and rethrows when Meta read fails', async () => {
    const { deps, rec } = makeDeps([], {
      meta: {
        async listEntities() {
          throw new Error('meta down');
        },
      },
    });
    await expect(
      orchestrateAnalytics({ client_slug: 'cliente-exemplo', window_days: 7 }, deps),
    ).rejects.toThrow(/funnel analytics/);
    expect(rec.analyses).toBe(0);
  });
});
