import { describe, expect, it } from 'vitest';

import {
  buildLandingJob,
  enqueueLandingJob,
  isLandingUniqueViolation,
  resolveLandingSkill,
  type LandingInsertResult,
  type LandingJobInsert,
  type LandingJobInserter,
} from '../lib/api/landing-publish';

const LP = '44444444-4444-4444-4444-444444444444';

describe('resolveLandingSkill: server-side allowlist', () => {
  it('resolves known landing kinds to a skill', () => {
    expect(resolveLandingSkill('landing_publish')).toEqual({
      kind: 'landing_publish',
      skill: 'publish-landing-page-cliente-exemplo',
    });
    expect(resolveLandingSkill('landing_edit')?.kind).toBe('landing_edit');
  });
  it('returns null for an unknown kind (never free text)', () => {
    expect(resolveLandingSkill('create')).toBeNull();
    expect(resolveLandingSkill('__proto__')).toBeNull();
    expect(resolveLandingSkill('rm -rf')).toBeNull();
  });
});

describe('buildLandingJob', () => {
  it('builds an agent_jobs row keyed by landing_page_id', () => {
    const row = buildLandingJob({ landingPageId: LP, kind: 'landing_publish', skill: 'publish-x' });
    expect(row).toEqual({
      landing_page_id: LP,
      skill: 'publish-x',
      kind: 'landing_publish',
      args: { landing_page_id: LP },
      status: 'pending',
      requested_by: 'dashboard',
    });
  });
});

describe('enqueueLandingJob: dedup → already_queued', () => {
  class FakeInserter implements LandingJobInserter {
    rows: LandingJobInsert[] = [];
    private seen = new Set<string>();
    private n = 0;
    async insert(row: LandingJobInsert): Promise<LandingInsertResult> {
      const key = `${row.landing_page_id}:${row.kind}`;
      if (this.seen.has(key)) {
        return { conflict: true };
      }
      this.seen.add(key);
      this.rows.push(row);
      this.n += 1;
      return { conflict: false, id: `lpjob-${this.n}` };
    }
  }

  it('queues once and dedups the second active publish', async () => {
    const inserter = new FakeInserter();
    const row = buildLandingJob({ landingPageId: LP, kind: 'landing_publish', skill: 's' });
    const first = await enqueueLandingJob(inserter, row);
    const second = await enqueueLandingJob(inserter, row);
    expect(first).toEqual({ status: 'queued', agent_job_id: 'lpjob-1' });
    expect(second).toEqual({ status: 'already_queued', agent_job_id: null });
    expect(inserter.rows).toHaveLength(1);
  });

  it('detects the Postgres unique-violation SQLSTATE', () => {
    expect(isLandingUniqueViolation({ code: '23505' })).toBe(true);
    expect(isLandingUniqueViolation({ code: '23503' })).toBe(false);
    expect(isLandingUniqueViolation(null)).toBe(false);
  });
});
