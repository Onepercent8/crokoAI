import 'server-only';

import { z } from 'zod';

import { listAnalyses, listAnalysisFindings } from '../services/analyses';
import { listCampaigns } from '../services/campaigns';
import { getClientBySlug } from '../services/clients';
import { listFunnelEvents } from '../services/funnel';
import { listOperationLogs } from '../services/logs';
import type { ReadToolHandlers, ReadToolResult, ResolveClientId } from './chat-loop';

/**
 * Server-side wiring of the Nexus read tools to `lib/services/*` (SPEC-016
 * §"Tools de leitura"). All reads go through the `service_role` client; the
 * browser never touches the database. Inputs are validated again here (Zod)
 * before any service call — the model's tool input is untrusted data.
 *
 * Each tool resolves the `client_slug` to a real client first; an unknown slug
 * is an error (never a silent empty result that the model could misread).
 */

const Slug = z.string().regex(/^[a-z0-9-]{1,64}$/, 'invalid client slug');

function parseClientSlug(input: Record<string, unknown>): string | null {
  const parsed = Slug.safeParse(input.client_slug);
  return parsed.success ? parsed.data : null;
}

/** Resolve a client slug to its UUID via the read service (server-side). */
export const resolveClientId: ResolveClientId = async (clientSlug) => {
  const parsed = Slug.safeParse(clientSlug);
  if (!parsed.success) {
    return null;
  }
  const client = await getClientBySlug(parsed.data);
  return client?.id ?? null;
};

async function withClient(
  input: Record<string, unknown>,
  read: (clientId: string) => Promise<unknown>,
): Promise<ReadToolResult> {
  const slug = parseClientSlug(input);
  if (slug === null) {
    return { ok: false, error: 'invalid_client_slug' };
  }
  try {
    const client = await getClientBySlug(slug);
    if (client === null) {
      return { ok: false, error: 'unknown_client' };
    }
    return { ok: true, data: await read(client.id) };
  } catch (error) {
    // No PII in logs — only the operation context.
    console.error(
      JSON.stringify({ level: 'error', op: 'nexus_read', message: (error as Error).message }),
    );
    return { ok: false, error: 'read_failed' };
  }
}

/** The production read-tool handlers. */
export const readToolHandlers: ReadToolHandlers = {
  get_client_overview: (input) =>
    withClient(input, async (clientId) => {
      const [campaigns, analyses] = await Promise.all([
        listCampaigns(clientId),
        listAnalyses(clientId),
      ]);
      return {
        client_id: clientId,
        campaign_count: campaigns.length,
        latest_analysis: analyses[0] ?? null,
      };
    }),

  get_latest_analysis: (input) =>
    withClient(input, async (clientId) => {
      const analyses = await listAnalyses(clientId);
      const latest = analyses[0] ?? null;
      if (latest === null) {
        return { analysis: null, findings: [] };
      }
      const findings = await listAnalysisFindings(latest.id);
      return { analysis: latest, findings };
    }),

  get_funnel: (input) =>
    withClient(input, async (clientId) => {
      const analyses = await listAnalyses(clientId);
      const latest = analyses[0] ?? null;
      if (latest === null) {
        return { analysis: null, events: [] };
      }
      const events = await listFunnelEvents(latest.id);
      return { analysis_id: latest.id, events };
    }),

  list_campaigns: (input) =>
    withClient(input, async (clientId) => ({ campaigns: await listCampaigns(clientId) })),

  get_operation_logs: (input) =>
    withClient(input, async (clientId) => ({ logs: await listOperationLogs(clientId) })),
};
