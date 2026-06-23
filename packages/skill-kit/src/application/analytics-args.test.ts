import { describe, expect, it } from 'vitest';
import { DailySummaryArgsSchema, FunnelAnalyticsArgsSchema } from './analytics-args.js';

describe('FunnelAnalyticsArgsSchema', () => {
  it('applies defaults', () => {
    const parsed = FunnelAnalyticsArgsSchema.parse({ client_slug: 'cliente-exemplo' });
    expect(parsed.window_days).toBe(7);
    expect(parsed.compare_window).toBe(true);
    expect(parsed.triggered_by).toBe('cron');
  });
  it('rejects an invalid slug charset', () => {
    expect(() => FunnelAnalyticsArgsSchema.parse({ client_slug: 'Bad Slug' })).toThrow();
  });
  it('rejects window_days out of range', () => {
    expect(() =>
      FunnelAnalyticsArgsSchema.parse({ client_slug: 'cliente-exemplo', window_days: 0 }),
    ).toThrow();
    expect(() =>
      FunnelAnalyticsArgsSchema.parse({ client_slug: 'cliente-exemplo', window_days: 91 }),
    ).toThrow();
  });
});

describe('DailySummaryArgsSchema', () => {
  it('accepts a valid date', () => {
    const parsed = DailySummaryArgsSchema.parse({
      client_slug: 'cliente-exemplo',
      summary_date: '2026-06-23',
    });
    expect(parsed.notify_telegram).toBe(false);
  });
  it('rejects a malformed date', () => {
    expect(() =>
      DailySummaryArgsSchema.parse({ client_slug: 'cliente-exemplo', summary_date: '23/06/2026' }),
    ).toThrow();
  });
});
