/**
 * Analytics orchestrator (meta-ads-funnel-analytics §Comportamento).
 *
 * Pure orchestration over injected ports. READ-ONLY on Meta: the port exposes
 * ONLY read methods, so a mutation is impossible by construction (gate "no Meta
 * mutation"). Writes 1 analyses + N metric_snapshots + M findings + 7
 * funnel_events per entity (+ account). NO I/O here; everything is a port.
 */

import {
  aggregateAccount,
  deriveFunnel,
  type FunnelEvent,
  type FunnelInsights,
} from '../domain/funnel.js';
import {
  deriveFindings,
  deriveVerdict,
  type Finding,
  type OverallVerdict,
} from '../domain/verdict.js';
import type { ClientRecord } from './ports.js';

/** One analyzed entity + its window insights and raw payload. */
export interface EntityInsights {
  level: 'campaign' | 'ad_set' | 'ad';
  meta_entity_id: string;
  insights: FunnelInsights;
  /** Raw Meta payload kept for audit/reprocessing (`raw jsonb`). */
  raw: Record<string, unknown>;
}

/**
 * READ-ONLY Meta boundary for analytics. Note: there are NO write methods here,
 * which structurally guarantees the analytics skill never mutates the account.
 */
export interface MetaReadPort {
  /** List entities with activity for a client over a window (read-only). */
  listEntities(clientSlug: string, windowDays: number): Promise<EntityInsights[]>;
}

/** Persistence boundary for analytics (REST + service_role in production). */
export interface AnalyticsPersistencePort {
  insertAnalysis(row: Record<string, unknown>): Promise<{ id: string }>;
  insertMetricSnapshots(rows: Record<string, unknown>[]): Promise<{ ids: string[] }>;
  insertFindings(rows: Record<string, unknown>[]): Promise<{ ids: string[] }>;
  insertFunnelEvents(rows: Record<string, unknown>[]): Promise<{ ids: string[] }>;
  insertOperationLog(row: Record<string, unknown>): Promise<{ id: string }>;
}

export interface AnalyticsManifest {
  run_id: string;
  skill: string;
  client_slug: string;
  window_days: number;
  entities_analyzed: number;
  overall_verdict: OverallVerdict;
  analysis_id: string | null;
  status: 'completed' | 'failed';
  started_at: string;
  finished_at: string;
  error?: string;
}

export interface OrchestrateAnalyticsDeps {
  meta: MetaReadPort;
  catalogueLoadClient: (slug: string) => Promise<ClientRecord>;
  persistence: AnalyticsPersistencePort;
  writeManifest: (m: AnalyticsManifest, stampIso: string) => Promise<string>;
  clock: { now(): Date; newRunId(): string };
}

export interface OrchestrateAnalyticsResult {
  analysisId: string | null;
  overallVerdict: OverallVerdict;
  funnelEventsWritten: number;
  metricSnapshotsWritten: number;
  findingsWritten: number;
  manifestPath: string;
}

const SKILL = 'funnel-analytics';

/**
 * Build the per-entity funnel rows + the aggregate account-level rows.
 * Returns flat rows ready for persistence (each carries `analysis_id` later).
 */
export function buildFunnelRows(
  entities: readonly EntityInsights[],
): Array<{ level: string; meta_entity_id: string; events: FunnelEvent[] }> {
  const perEntity: Array<{ level: string; meta_entity_id: string; events: FunnelEvent[] }> =
    entities.map((e) => ({
      level: e.level,
      meta_entity_id: e.meta_entity_id,
      events: deriveFunnel(e.insights),
    }));
  const account = aggregateAccount(entities.map((e) => e.insights));
  perEntity.push({ level: 'account', meta_entity_id: 'account', events: deriveFunnel(account) });
  return perEntity;
}

/** Run the funnel-analytics skill end to end (read-only on Meta). */
export async function orchestrateAnalytics(
  args: { client_slug: string; window_days: number },
  deps: OrchestrateAnalyticsDeps,
): Promise<OrchestrateAnalyticsResult> {
  const runId = deps.clock.newRunId();
  const startedAt = deps.clock.now().toISOString();
  const client = await deps.catalogueLoadClient(args.client_slug);

  try {
    const entities = await deps.meta.listEntities(client.slug, args.window_days);
    const account = aggregateAccount(entities.map((e) => e.insights));
    const accountFunnel = deriveFunnel(account);
    const verdict: OverallVerdict =
      entities.length === 0
        ? 'no_data'
        : deriveVerdict({ funnel: accountFunnel, spend_cents: account.spend_cents });

    const analysis = await deps.persistence.insertAnalysis({
      client_id: client.id,
      objective: 'OUTCOME_TRAFFIC',
      window_days: args.window_days,
      entities_analyzed: entities.length,
      overall_verdict: verdict,
      summary: `analyzed ${entities.length} entities; verdict=${verdict}`,
      triggered_by: 'cron',
      raw_spec: { run_id: runId, window_days: args.window_days },
    });
    await deps.persistence.insertOperationLog({
      entity_type: 'campaign',
      entity_id: 'account',
      action: 'create',
      actor: `skill:${SKILL}`,
      summary: `analysis ${analysis.id} (${verdict})`,
    });

    if (entities.length === 0) {
      const finishedAt = deps.clock.now().toISOString();
      const manifest: AnalyticsManifest = {
        run_id: runId,
        skill: SKILL,
        client_slug: client.slug,
        window_days: args.window_days,
        entities_analyzed: 0,
        overall_verdict: verdict,
        analysis_id: analysis.id,
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
      };
      const path = await deps.writeManifest(manifest, finishedAt);
      return {
        analysisId: analysis.id,
        overallVerdict: verdict,
        funnelEventsWritten: 0,
        metricSnapshotsWritten: 0,
        findingsWritten: 0,
        manifestPath: path,
      };
    }

    // metric_snapshots: one per entity (+ raw payload for audit).
    const snapshotRows = entities.map((e) => ({
      analysis_id: analysis.id,
      level: e.level,
      meta_entity_id: e.meta_entity_id,
      impressions: e.insights.impressions,
      spend_cents: e.insights.spend_cents,
      landing_page_views: e.insights.landing_page_views,
      results: e.insights.purchases,
      raw: e.raw,
      raw_spec: { meta_entity_id: e.meta_entity_id },
    }));
    const snapshots = await deps.persistence.insertMetricSnapshots(snapshotRows);

    // funnel_events: 7 per entity + 7 for the account aggregate.
    const funnelGroups = buildFunnelRows(entities);
    const funnelRows = funnelGroups.flatMap((g) =>
      g.events.map((ev) => ({
        analysis_id: analysis.id,
        level: g.level,
        meta_entity_id: g.meta_entity_id,
        step_order: ev.step_order,
        event_type: ev.event_type,
        count: ev.count,
        value_cents: ev.value_cents,
        cost_per_event_cents: ev.cost_per_event_cents,
        cvr_from_prev: ev.cvr_from_prev,
        cvr_from_top: ev.cvr_from_top,
        raw_spec: { step: ev.event_type },
      })),
    );
    const funnel = await deps.persistence.insertFunnelEvents(funnelRows);

    // findings: cross-metric diagnostics anchored to the account funnel.
    const findings: Finding[] = deriveFindings({
      funnel: accountFunnel,
      spend_cents: account.spend_cents,
    });
    const findingRows = findings.map((f) => ({
      analysis_id: analysis.id,
      severity: f.severity,
      diagnosis: f.diagnosis,
      evidence: f.evidence,
      recommended_action: f.recommended_action,
      recommendation_type: f.recommendation_type,
      confidence: f.confidence,
      is_significant: f.is_significant,
      raw_spec: { type: f.recommendation_type },
    }));
    const findingIds = await deps.persistence.insertFindings(findingRows);

    const finishedAt = deps.clock.now().toISOString();
    const manifest: AnalyticsManifest = {
      run_id: runId,
      skill: SKILL,
      client_slug: client.slug,
      window_days: args.window_days,
      entities_analyzed: entities.length,
      overall_verdict: verdict,
      analysis_id: analysis.id,
      status: 'completed',
      started_at: startedAt,
      finished_at: finishedAt,
    };
    const manifestPath = await deps.writeManifest(manifest, finishedAt);

    return {
      analysisId: analysis.id,
      overallVerdict: verdict,
      funnelEventsWritten: funnel.ids.length,
      metricSnapshotsWritten: snapshots.ids.length,
      findingsWritten: findingIds.ids.length,
      manifestPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = deps.clock.now().toISOString();
    const manifest: AnalyticsManifest = {
      run_id: runId,
      skill: SKILL,
      client_slug: args.client_slug,
      window_days: args.window_days,
      entities_analyzed: 0,
      overall_verdict: 'error',
      analysis_id: null,
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      error: message,
    };
    await deps.writeManifest(manifest, finishedAt);
    throw new Error(`Failed to run funnel analytics: ${message}`);
  }
}
