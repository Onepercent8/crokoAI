import { describe, expect, it } from 'vitest';

import { parsePublicEnv, parseServerEnv } from '../lib/env';

const validServer = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'secret',
  AUTH_SECRET: 'x'.repeat(32),
  DASHBOARD_PASSWORD: 'a'.repeat(64),
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'token',
} as unknown as NodeJS.ProcessEnv;

describe('env', () => {
  it('accepts a valid server env', () => {
    expect(() => parseServerEnv(validServer)).not.toThrow();
  });

  it('rejects a too-short AUTH_SECRET', () => {
    expect(() => parseServerEnv({ ...validServer, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('rejects a non-hex DASHBOARD_PASSWORD', () => {
    expect(() => parseServerEnv({ ...validServer, DASHBOARD_PASSWORD: 'z'.repeat(64) })).toThrow(
      /DASHBOARD_PASSWORD/,
    );
  });

  it('accepts a valid public env', () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pub',
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
