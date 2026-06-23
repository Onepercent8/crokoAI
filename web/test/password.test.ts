import { describe, expect, it } from 'vitest';

import { sha256Hex, timingSafeEqualHex, verifyPassword } from '../lib/auth/password';

describe('password', () => {
  it('computes a known SHA-256 hex digest', async () => {
    // SHA-256("abc")
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('timingSafeEqualHex matches equal strings and rejects different ones', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true);
    expect(timingSafeEqualHex('deadbeef', 'deadbee0')).toBe(false);
    expect(timingSafeEqualHex('dead', 'deadbeef')).toBe(false);
  });

  it('verifyPassword accepts the correct password and rejects others', async () => {
    const stored = await sha256Hex('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });
});
