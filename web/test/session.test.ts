import { describe, expect, it } from 'vitest';

import { issueSession, verifySession } from '../lib/auth/session';

const SECRET = 'a'.repeat(48);

describe('session', () => {
  it('issues a token that verifies with the same secret', async () => {
    const token = await issueSession(SECRET);
    const claims = await verifySession(token, SECRET);
    expect(claims?.sub).toBe('operator');
  });

  it('rejects a token verified with a different secret', async () => {
    const token = await issueSession(SECRET);
    expect(await verifySession(token, 'b'.repeat(48))).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await issueSession(SECRET);
    const tampered = `${token.slice(0, -2)}xx`;
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it('rejects a missing token', async () => {
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(null, SECRET)).toBeNull();
  });
});
