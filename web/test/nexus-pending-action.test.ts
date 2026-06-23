import { describe, expect, it } from 'vitest';

import {
  createPendingAction,
  InMemoryPendingActionStore,
  PENDING_ACTION_TTL_SECONDS,
} from '../lib/nexus/pending-action';

const SESSION = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';

function makeRecord(id: string, nowMs: number) {
  return createPendingAction({
    session_id: SESSION,
    slug: 'create',
    kind: 'create',
    client_id: CLIENT,
    args: { client_slug: 'cliente-exemplo' },
    nowMs,
    newId: () => id,
  });
}

describe('pending action: createPendingAction', () => {
  it('builds a record + public view with a future expiry', () => {
    const now = 1_000_000;
    const { record, view } = makeRecord('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now);
    expect(record.consumed).toBe(false);
    expect(record.expires_at_ms).toBe(now + PENDING_ACTION_TTL_SECONDS * 1000);
    expect(view.action_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(view.args_preview).toEqual({ client_slug: 'cliente-exemplo' });
  });
});

describe('pending action store: single-use + expiry', () => {
  it('consumes a valid action exactly once', async () => {
    const store = new InMemoryPendingActionStore();
    const now = 1_000_000;
    const { record } = makeRecord('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now);
    await store.put(record);

    const first = await store.consume(SESSION, record.action_id, now + 1000);
    expect(first.ok).toBe(true);

    // Second consume of the same id is rejected (single-use).
    const second = await store.consume(SESSION, record.action_id, now + 2000);
    expect(second).toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects a wrong-session consume (scoped to session)', async () => {
    const store = new InMemoryPendingActionStore();
    const { record } = makeRecord('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0);
    await store.put(record);
    const res = await store.consume('99999999-9999-9999-9999-999999999999', record.action_id, 1);
    expect(res).toEqual({ ok: false, reason: 'rejected' });
  });

  it('rejects an unknown action id', async () => {
    const store = new InMemoryPendingActionStore();
    const res = await store.consume(SESSION, 'does-not-exist', 1);
    expect(res).toEqual({ ok: false, reason: 'rejected' });
  });

  it('expires an action past its TTL and burns it', async () => {
    const store = new InMemoryPendingActionStore();
    const now = 1_000_000;
    const { record } = makeRecord('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now);
    await store.put(record);

    const expiredAt = now + PENDING_ACTION_TTL_SECONDS * 1000 + 1;
    const res = await store.consume(SESSION, record.action_id, expiredAt);
    expect(res).toEqual({ ok: false, reason: 'expired' });

    // Burned — a later attempt is rejected, not "expired" again.
    const again = await store.consume(SESSION, record.action_id, expiredAt + 1);
    expect(again).toEqual({ ok: false, reason: 'rejected' });
  });
});
