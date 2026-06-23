import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('emits one JSON line per log with run_id + event', () => {
    const lines: string[] = [];
    const logger = createLogger('run-123', (l) => lines.push(l));
    logger.log('info', 'campaign.created', { meta_campaign_id: 'camp_1' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.run_id).toBe('run-123');
    expect(parsed.event).toBe('campaign.created');
    expect(parsed.level).toBe('info');
    expect(parsed.meta_campaign_id).toBe('camp_1');
  });

  it('redacts secret/PII keys (defense in depth)', () => {
    const lines: string[] = [];
    const logger = createLogger('run-123', (l) => lines.push(l));
    logger.log('error', 'boom', {
      supabase_secret_key: 'sk_should_not_appear',
      email: 'user@example.com',
      token: 'abc',
      safe_field: 'ok',
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.supabase_secret_key).toBe('[redacted]');
    expect(parsed.email).toBe('[redacted]');
    expect(parsed.token).toBe('[redacted]');
    expect(parsed.safe_field).toBe('ok');
    expect(lines[0]).not.toContain('sk_should_not_appear');
    expect(lines[0]).not.toContain('user@example.com');
  });
});
