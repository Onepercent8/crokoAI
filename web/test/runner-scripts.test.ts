import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { resolveSkill } from '../lib/nexus/tools';

/**
 * Cover the runner-side CommonJS scripts' pure cores (SSRF guard + email plan +
 * phase decision) so the same invariants are tested on both the TS and the .cjs
 * side. The .cjs modules export their pure functions and only run `main()` when
 * invoked directly, so requiring them here is side-effect-free.
 */
const require = createRequire(import.meta.url);
const screenshot = require('../../scripts/screenshot-page.cjs') as {
  assertSafeUrl(raw: string): string;
  ALLOWED_SUFFIX: string;
};
const email = require('../../scripts/send-email.cjs') as {
  planSend(
    env: Record<string, string | undefined>,
    subject?: string,
    body?: string,
  ): { action: string; reason?: string };
};
const tick = require('../../scripts/autonomous-watch-tick.cjs') as {
  decideTick(input: unknown): { narration: unknown };
  isForwardTransition(a: string, b: string): boolean;
};

describe('screenshot-page.cjs: SSRF guard (runner side)', () => {
  it('accepts a safe https *.example.com url', () => {
    expect(screenshot.assertSafeUrl('https://promo.example.com/')).toContain('promo.example.com');
  });
  it('blocks http, localhost, IPs, metadata, and arbitrary hosts', () => {
    expect(() => screenshot.assertSafeUrl('http://promo.example.com')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://localhost')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://127.0.0.1')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://169.254.169.254')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://[::1]/')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://evil.com')).toThrow(/ssrf/);
    expect(() => screenshot.assertSafeUrl('https://example.com.evil.com')).toThrow(/ssrf/);
  });
});

describe('send-email.cjs: best-effort plan', () => {
  it('degrades when Resend is not configured', () => {
    expect(email.planSend({}, 's', 'b').action).toBe('degrade');
  });
  it('skips when subject/body are missing', () => {
    expect(email.planSend({ RESEND_API_KEY: 'k' }, '', '').action).toBe('skip');
  });
  it('sends when fully configured', () => {
    const plan = email.planSend(
      {
        RESEND_API_KEY: 'k',
        AUTONOMOUS_FROM_EMAIL: 'a@example.com',
        AUTONOMOUS_NOTIFY_EMAIL: 'b@example.com',
      },
      's',
      'b',
    );
    expect(plan.action).toBe('send');
  });
});

describe('autonomous-watch-tick.cjs: phase decision mirrors the TS module', () => {
  it('narrates ≤1 progress step while watching', () => {
    const plan = tick.decideTick({
      watch: {
        id: 'w',
        phase: 'watching',
        hasReview: false,
        last_event_ts: null,
        last_narrated_milestone: null,
      },
      jobStatus: 'running',
      events: [
        { ts: 't1', event_type: 'step', label: 'E1' },
        { ts: 't2', event_type: 'step', label: 'E2' },
      ],
    });
    expect(plan.narration).not.toBeNull();
  });
  it('never regresses the phase', () => {
    expect(tick.isForwardTransition('notifying', 'watching')).toBe(false);
    expect(tick.isForwardTransition('watching', 'failed')).toBe(true);
  });
});

describe('Nexus skill allowlist is preserved (unchanged by Wave 9)', () => {
  it('still resolves known write slugs and rejects unknown ones', () => {
    expect(resolveSkill('landing')?.skill).toBe('create-landing-page-cliente-exemplo');
    expect(resolveSkill('publish')?.kind).toBe('landing_publish');
    expect(resolveSkill('definitely-not-a-slug')).toBeNull();
  });
});
