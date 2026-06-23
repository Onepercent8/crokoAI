import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';
import type { AgentEventRow, OperationLogRow } from './types';

/**
 * Read service for audit logs (SPEC-000 §6/§10).
 *
 * `operation_logs` and `agent_events` are append-only; the dashboard ONLY reads
 * them in this wave. Logs are NO-PII by construction (the writers never store
 * PII), so no redaction is needed here.
 */

const OPERATION_LOG_COLUMNS =
  'id, client_id, entity_type, entity_id, action, actor, summary, created_at';

const AGENT_EVENT_COLUMNS = 'id, run_id, agent_name, agent_type, event_type, tool_name, created_at';

const DEFAULT_LIMIT = 100;

const uuidSchema = z.string().uuid();
const runIdSchema = z.string().min(1).max(128);
const limitSchema = z.number().int().min(1).max(500).default(DEFAULT_LIMIT);

/** List operation logs for a client (most recent first). */
export async function listOperationLogs(
  clientId: string,
  limit?: number,
): Promise<OperationLogRow[]> {
  const parsedClientId = uuidSchema.parse(clientId);
  const parsedLimit = limitSchema.parse(limit ?? DEFAULT_LIMIT);
  const { data, error } = await getDb()
    .from('operation_logs')
    .select(OPERATION_LOG_COLUMNS)
    .eq('client_id', parsedClientId)
    .order('created_at', { ascending: false })
    .limit(parsedLimit);
  if (error) {
    throw new Error(`Failed to list operation logs: ${error.message}`);
  }
  return (data ?? []) as OperationLogRow[];
}

/**
 * List agent events, optionally filtered by `run_id` (most recent first).
 * @param runId optional correlation id to scope a single run
 */
export async function listAgentEvents(runId?: string, limit?: number): Promise<AgentEventRow[]> {
  const parsedLimit = limitSchema.parse(limit ?? DEFAULT_LIMIT);
  let query = getDb()
    .from('agent_events')
    .select(AGENT_EVENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(parsedLimit);
  if (runId !== undefined) {
    query = query.eq('run_id', runIdSchema.parse(runId));
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list agent events: ${error.message}`);
  }
  return (data ?? []) as AgentEventRow[];
}
