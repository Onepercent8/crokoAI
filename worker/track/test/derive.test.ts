import { describe, it, expect } from 'vitest';
import {
  deriveHashedUserData,
  normalizeEmail,
  normalizePhone,
  sha256Hex,
  toLpEventRow,
} from '../src/derive.js';
import { trackEventSchema } from '../src/schema.js';
import { validEvent } from './mocks.js';

function parse(overrides: Record<string, unknown> = {}) {
  const r = trackEventSchema.safeParse(validEvent(overrides));
  if (!r.success) throw new Error('fixture invalid');
  return r.data;
}

describe('toLpEventRow (NO-PII mirror)', () => {
  it('never includes email or phone, only boolean flags', () => {
    const row = toLpEventRow(parse(), 'BR');
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('Lead@Example.com');
    expect(serialized.toLowerCase()).not.toContain('lead@example.com');
    expect(serialized).not.toContain('99999');
    expect(row.has_email).toBe(true);
    expect(row.has_phone).toBe(true);
    // The row has no email/phone keys at all.
    expect(Object.keys(row)).not.toContain('email');
    expect(Object.keys(row)).not.toContain('phone');
  });

  it('keeps value_cents as an integer and uppercases currency', () => {
    const row = toLpEventRow(parse(), 'BR');
    expect(row.value_cents).toBe(19700);
    expect(Number.isInteger(row.value_cents)).toBe(true);
    expect(row.currency).toBe('BRL');
  });

  it('takes country from the edge geo, not the body', () => {
    const row = toLpEventRow(parse(), 'US');
    expect(row.country).toBe('US');
  });

  it('flags are false when PII is absent', () => {
    const e = validEvent();
    delete (e as Record<string, unknown>).email;
    delete (e as Record<string, unknown>).phone;
    const row = toLpEventRow(trackEventSchema.parse(e), undefined);
    expect(row.has_email).toBe(false);
    expect(row.has_phone).toBe(false);
    expect(row.country).toBeUndefined();
  });

  it('maps utm fields onto utm_* columns', () => {
    const row = toLpEventRow(parse(), 'BR');
    expect(row.utm_source).toBe('meta');
    expect(row.utm_campaign).toBe('curso-exemplo');
  });
});

describe('hashing', () => {
  it('normalizes email (trim + lowercase) and phone (digits only)', () => {
    expect(normalizeEmail('  Lead@Example.com ')).toBe('lead@example.com');
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('5511999990000');
  });

  it('sha256Hex is deterministic and 64 hex chars', async () => {
    const a = await sha256Hex('lead@example.com');
    const b = await sha256Hex('lead@example.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deriveHashedUserData hashes both identifiers and exposes no raw PII', async () => {
    const hashed = await deriveHashedUserData(parse());
    expect(hashed.emailSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed.phoneSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hashed)).not.toContain('@');
  });
});
