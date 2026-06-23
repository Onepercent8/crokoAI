import { describe, expect, it } from 'vitest';
import { mapStreamLine, parseStream, stripPayload } from './stream-events.js';

const RUN = 'run-1';
const NAME = 'create-traffic';

describe('mapStreamLine', () => {
  it('maps a system init line to a start event', () => {
    const ev = mapStreamLine({ type: 'system', subtype: 'init' }, RUN, NAME);
    expect(ev?.event_type).toBe('start');
    expect(ev?.agent_type).toBe('system');
  });

  it('maps a result line to an end event', () => {
    const ev = mapStreamLine({ type: 'result', subtype: 'success' }, RUN, NAME);
    expect(ev?.event_type).toBe('end');
  });

  it('maps a tool_use line to a decision with the tool name', () => {
    const ev = mapStreamLine(
      { type: 'tool_use', name: 'mcp__mcp-meta-ads__create_campaign' },
      RUN,
      NAME,
    );
    expect(ev?.event_type).toBe('decision');
    expect(ev?.agent_type).toBe('tool');
    expect(ev?.tool_name).toBe('mcp__mcp-meta-ads__create_campaign');
  });

  it('maps an error line to an error event', () => {
    const ev = mapStreamLine({ type: 'assistant', is_error: true }, RUN, NAME);
    expect(ev?.event_type).toBe('error');
  });

  it('maps assistant/user lines to step events', () => {
    expect(mapStreamLine({ type: 'assistant' }, RUN, NAME)?.event_type).toBe('step');
    expect(mapStreamLine({ type: 'user' }, RUN, NAME)?.event_type).toBe('step');
  });

  it('returns null for an unknown line type', () => {
    expect(mapStreamLine({ type: 'whatever' }, RUN, NAME)).toBeNull();
  });
});

describe('stripPayload (NO-PII)', () => {
  it('keeps only safe scalar keys and drops everything else', () => {
    const out = stripPayload({
      subtype: 'init',
      duration_ms: 12,
      email: 'a@b.com',
      content: 'secret prose',
      nested: { x: 1 },
    });
    expect(out).toEqual({ subtype: 'init', duration_ms: 12 });
    expect(out).not.toHaveProperty('email');
    expect(out).not.toHaveProperty('content');
  });
});

describe('parseStream', () => {
  it('parses multiple lines, skips malformed ones, drops non-telemetry', () => {
    const chunk = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      'not json',
      JSON.stringify({ type: 'tool_use', name: 'Read' }),
      JSON.stringify({ type: 'whatever' }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
      '',
    ].join('\n');
    const events = parseStream(chunk, RUN, NAME);
    expect(events.map((e) => e.event_type)).toEqual(['start', 'decision', 'end']);
    expect(events.every((e) => e.run_id === RUN)).toBe(true);
  });
});
