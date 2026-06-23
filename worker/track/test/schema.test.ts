import { describe, it, expect } from 'vitest';
import { trackEventSchema } from '../src/schema.js';
import { validEvent } from './mocks.js';

describe('trackEventSchema', () => {
  it('accepts a valid event', () => {
    expect(trackEventSchema.safeParse(validEvent()).success).toBe(true);
  });

  it('rejects an event_type outside the enum', () => {
    expect(trackEventSchema.safeParse(validEvent({ event_type: 'scroll' })).success).toBe(false);
  });

  it('rejects a non-integer value_cents (money is integer cents)', () => {
    expect(trackEventSchema.safeParse(validEvent({ value_cents: 197.5 })).success).toBe(false);
  });

  it('rejects a negative value_cents', () => {
    expect(trackEventSchema.safeParse(validEvent({ value_cents: -1 })).success).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(trackEventSchema.safeParse(validEvent({ injected: 'x' })).success).toBe(false);
  });

  it('rejects a non-uuid event_id', () => {
    expect(trackEventSchema.safeParse(validEvent({ event_id: 'abc' })).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(trackEventSchema.safeParse(validEvent({ email: 'not-an-email' })).success).toBe(false);
  });

  it('accepts an event without PII (email/phone optional)', () => {
    const e = validEvent();
    delete (e as Record<string, unknown>).email;
    delete (e as Record<string, unknown>).phone;
    expect(trackEventSchema.safeParse(e).success).toBe(true);
  });
});
