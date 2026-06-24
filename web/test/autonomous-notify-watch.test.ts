import { describe, expect, it } from 'vitest';

import { notifyBestEffort, type NotifyTransport } from '../lib/nexus/notify';
import {
  buildWatch,
  kindHasReview,
  startWatch,
  WATCHABLE_KINDS,
  type StartWatchInput,
  type WatchInsert,
  type WatchInserter,
} from '../lib/nexus/watch';

describe('notifyBestEffort: fail-safe (degrades to log, never throws)', () => {
  it('returns delivered:true when the transport succeeds', async () => {
    const transport: NotifyTransport = { async send() {} };
    const out = await notifyBestEffort(transport, { subject: 's', body: 'b' });
    expect(out).toEqual({ delivered: true });
  });

  it('degrades to log when the transport throws (no propagation)', async () => {
    const transport: NotifyTransport = {
      async send() {
        throw new Error('resend 500');
      },
    };
    const out = await notifyBestEffort(transport, { subject: 's', body: 'b' });
    expect(out).toEqual({ delivered: false, degradedToLog: true });
  });

  it('degrades to log when no transport is configured', async () => {
    const out = await notifyBestEffort(null, { subject: 's', body: 'b' });
    expect(out).toEqual({ delivered: false, degradedToLog: true });
  });
});

describe('watch: buildWatch / startWatch', () => {
  const base: StartWatchInput = {
    clientId: '22222222-2222-2222-2222-222222222222',
    agentJobId: '33333333-3333-3333-3333-333333333333',
    kind: 'create',
    sessionId: 'sess-1',
  };

  it('builds a watching-phase row pointing at the job', () => {
    const row = buildWatch(base);
    expect(row).toMatchObject({
      client_id: base.clientId,
      agent_job_id: base.agentJobId,
      target_kind: 'create',
      phase: 'watching',
      publish_job_id: null,
    });
  });

  it('sets publish_job_id only for a landing_publish (review path)', () => {
    const row: WatchInsert = buildWatch({ ...base, kind: 'landing_publish' });
    expect(row.publish_job_id).toBe(base.agentJobId);
    expect(kindHasReview('landing_publish')).toBe(true);
    expect(kindHasReview('create')).toBe(false);
  });

  it('startWatch inserts the row and returns its id', async () => {
    const rows: WatchInsert[] = [];
    const inserter: WatchInserter = {
      async insert(row) {
        rows.push(row);
        return { id: 'watch-1' };
      },
    };
    const out = await startWatch(inserter, base);
    expect(out).toEqual({ watch_id: 'watch-1' });
    expect(rows).toHaveLength(1);
  });

  it('every watchable kind builds a watching-phase row', () => {
    for (const kind of WATCHABLE_KINDS) {
      const row = buildWatch({ ...base, kind });
      expect(row.phase).toBe('watching');
      expect(row.target_kind).toBe(kind);
    }
  });
});
