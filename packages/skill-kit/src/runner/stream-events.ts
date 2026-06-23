/**
 * stream-json -> agent_events mapping (flyio-cron-campaign-runner §emit-from-stream).
 *
 * Pure, testable mirror of `scripts/emit-from-stream.py`: maps a Claude Code
 * `--output-format stream-json` line to an append-only AgentEvent (or null when
 * the line is not telemetry-worthy). NO-PII: payloads are stripped to safe keys.
 */

import { z } from 'zod';

export const AgentEventTypeSchema = z.enum(['start', 'step', 'decision', 'error', 'end']);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const AgentAgentTypeSchema = z.enum(['skill', 'subagent', 'tool', 'system']);
export type AgentAgentType = z.infer<typeof AgentAgentTypeSchema>;

export interface AgentEvent {
  run_id: string;
  agent_name: string;
  agent_type: AgentAgentType;
  event_type: AgentEventType;
  tool_name: string | null;
  /** NO-PII payload. */
  payload: Record<string, unknown>;
}

/** Keys allowed to survive into a telemetry payload (everything else dropped). */
const SAFE_PAYLOAD_KEYS = new Set([
  'subtype',
  'tool',
  'tool_name',
  'name',
  'duration_ms',
  'num_turns',
  'is_error',
  'exit_code',
  'model',
]);

/** Keep only safe, non-PII keys from an arbitrary object. */
export function stripPayload(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SAFE_PAYLOAD_KEYS.has(key) && (typeof value !== 'object' || value === null)) {
      out[key] = value;
    }
  }
  return out;
}

interface StreamLine {
  type?: unknown;
  subtype?: unknown;
  name?: unknown;
  tool?: unknown;
  tool_name?: unknown;
  is_error?: unknown;
  [key: string]: unknown;
}

/**
 * Map one parsed stream-json object to an AgentEvent (or null to skip).
 *
 * Mapping (mirrors emit-from-stream.py):
 *  - {type:'system', subtype:'init'} -> start (agent_type system)
 *  - {type:'assistant'|'user'}       -> step  (skill)
 *  - tool_use / tool blocks          -> decision (tool, tool_name set)
 *  - {is_error:true} or type 'error' -> error
 *  - {type:'result'}                 -> end
 */
export function mapStreamLine(
  line: StreamLine,
  runId: string,
  agentName: string,
): AgentEvent | null {
  const type = typeof line.type === 'string' ? line.type : '';
  const base = {
    run_id: runId,
    agent_name: agentName,
    tool_name: null as string | null,
    payload: stripPayload(line),
  };

  if (line.is_error === true || type === 'error') {
    return { ...base, agent_type: 'system', event_type: 'error' };
  }
  if (type === 'system') {
    return { ...base, agent_type: 'system', event_type: 'start' };
  }
  if (type === 'result') {
    return { ...base, agent_type: 'system', event_type: 'end' };
  }
  const toolName =
    typeof line.tool_name === 'string'
      ? line.tool_name
      : typeof line.tool === 'string'
        ? line.tool
        : typeof line.name === 'string' && type === 'tool_use'
          ? line.name
          : null;
  if (toolName !== null || type === 'tool_use' || type === 'tool_result') {
    return { ...base, agent_type: 'tool', event_type: 'decision', tool_name: toolName };
  }
  if (type === 'assistant' || type === 'user') {
    return { ...base, agent_type: 'skill', event_type: 'step' };
  }
  return null;
}

/**
 * Parse a chunk of stream-json text (one JSON object per line) into events.
 * Malformed lines are skipped (never throw on a single bad line).
 */
export function parseStream(chunk: string, runId: string, agentName: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const raw of chunk.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue;
    }
    const event = mapStreamLine(parsed as StreamLine, runId, agentName);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}
