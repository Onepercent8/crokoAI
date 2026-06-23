import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey, resolveIdempotencyKey, utcDay } from './idempotency.js';

describe('idempotency key derivation', () => {
  const input = {
    client_slug: 'cliente-exemplo',
    product_slug: 'curso-exemplo',
    at: '2026-06-23T14:00:00.000Z',
  };

  it('is deterministic for the same (client, product, UTC day)', () => {
    const a = deriveIdempotencyKey(input);
    const b = deriveIdempotencyKey({ ...input, at: '2026-06-23T23:59:00.000Z' });
    expect(a).toBe(b);
  });

  it('changes across UTC days', () => {
    const a = deriveIdempotencyKey(input);
    const b = deriveIdempotencyKey({ ...input, at: '2026-06-24T00:00:00.000Z' });
    expect(a).not.toBe(b);
  });

  it('changes across products', () => {
    const a = deriveIdempotencyKey(input);
    const b = deriveIdempotencyKey({ ...input, product_slug: 'workshop-exemplo' });
    expect(a).not.toBe(b);
  });

  it('utcDay extracts the calendar day', () => {
    expect(utcDay('2026-06-23T14:00:00.000Z')).toBe('2026-06-23');
  });

  it('rejects an invalid date', () => {
    expect(() => deriveIdempotencyKey({ ...input, at: 'not-a-date' })).toThrow();
  });

  it('resolveIdempotencyKey prefers an explicit key', () => {
    expect(resolveIdempotencyKey('explicit-key-123', input)).toBe('explicit-key-123');
  });

  it('resolveIdempotencyKey derives when none given', () => {
    expect(resolveIdempotencyKey(undefined, input)).toBe(deriveIdempotencyKey(input));
  });

  it('rejects a too-short explicit key', () => {
    expect(() => resolveIdempotencyKey('short', input)).toThrow(/too short/);
  });
});
