import { describe, expect, it } from 'vitest';

import { confirmAction } from '../lib/nexus/confirm';
import {
  buildAgentJob,
  enqueueJob,
  isUniqueViolation,
  type AgentJobInsert,
  type InsertResult,
  type JobInserter,
} from '../lib/nexus/enqueue';
import { createPendingAction, InMemoryPendingActionStore } from '../lib/nexus/pending-action';

const SESSION = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';

/** Fake inserter that records rows and can be told to conflict. */
class FakeInserter implements JobInserter {
  rows: AgentJobInsert[] = [];
  private conflictKeys = new Set<string>();
  private nextId = 0;

  constructor(private readonly dedup = true) {}

  async insert(row: AgentJobInsert): Promise<InsertResult> {
    const key = `${row.client_id}:${row.kind}`;
    if (this.dedup && this.conflictKeys.has(key)) {
      return { conflict: true };
    }
    this.conflictKeys.add(key);
    this.rows.push(row);
    this.nextId += 1;
    return { conflict: false, id: `job-${this.nextId}` };
  }
}

async function seedPending(store: InMemoryPendingActionStore, id: string, nowMs: number) {
  const { record } = createPendingAction({
    session_id: SESSION,
    slug: 'create',
    kind: 'create',
    client_id: CLIENT,
    args: { client_slug: 'cliente-exemplo' },
    nowMs,
    newId: () => id,
  });
  await store.put(record);
  return id;
}

describe('enqueue helpers', () => {
  it('builds the agent_jobs row with requested_by=nexus and status=pending', () => {
    const row = buildAgentJob({ client_id: CLIENT, skill: 's', kind: 'create', args: { a: 1 } });
    expect(row).toEqual({
      client_id: CLIENT,
      skill: 's',
      kind: 'create',
      args: { a: 1 },
      status: 'pending',
      requested_by: 'nexus',
    });
  });

  it('maps a unique violation to already_queued', async () => {
    const inserter: JobInserter = {
      async insert() {
        return { conflict: true };
      },
    };
    const out = await enqueueJob(
      inserter,
      buildAgentJob({ client_id: CLIENT, skill: 's', kind: 'create', args: {} }),
    );
    expect(out).toEqual({ status: 'already_queued', agent_job_id: null });
  });

  it('detects the Postgres unique-violation SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('confirmAction: second-turn enqueue', () => {
  const now = () => 1_000_000;

  it('enqueues exactly one agent_jobs row on a valid confirm', async () => {
    const store = new InMemoryPendingActionStore();
    const inserter = new FakeInserter();
    const id = await seedPending(store, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());

    const res = await confirmAction({ pendingActions: store, inserter, now }, SESSION, id);
    expect(res.status).toBe('queued');
    expect(res.enqueued).toBe(true);
    expect(res.agent_job_id).toBe('job-1');
    expect(inserter.rows).toHaveLength(1);
    expect(inserter.rows[0]).toMatchObject({
      client_id: CLIENT,
      skill: 'create-traffic-cliente-exemplo-campaign',
      kind: 'create',
      requested_by: 'nexus',
      status: 'pending',
    });
  });

  it('dedups: confirming the same (client,kind) twice yields one job', async () => {
    const store = new InMemoryPendingActionStore();
    const inserter = new FakeInserter();
    const id1 = await seedPending(store, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());
    const id2 = await seedPending(store, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now());

    const first = await confirmAction({ pendingActions: store, inserter, now }, SESSION, id1);
    const second = await confirmAction({ pendingActions: store, inserter, now }, SESSION, id2);

    expect(first.status).toBe('queued');
    expect(second.status).toBe('already_queued');
    expect(second.agent_job_id).toBeNull();
    expect(inserter.rows).toHaveLength(1);
  });

  it('rejects a replayed (already consumed) action_id without enqueuing', async () => {
    const store = new InMemoryPendingActionStore();
    const inserter = new FakeInserter();
    const id = await seedPending(store, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());

    await confirmAction({ pendingActions: store, inserter, now }, SESSION, id);
    const replay = await confirmAction({ pendingActions: store, inserter, now }, SESSION, id);
    expect(replay.status).toBe('rejected');
    expect(replay.enqueued).toBe(false);
    expect(inserter.rows).toHaveLength(1); // no extra row
  });

  it('returns expired for an unknown/expired action_id', async () => {
    const store = new InMemoryPendingActionStore();
    const inserter = new FakeInserter();
    const res = await confirmAction({ pendingActions: store, inserter, now }, SESSION, 'nope');
    expect(res.status).toBe('rejected');
    expect(inserter.rows).toHaveLength(0);
  });
});
