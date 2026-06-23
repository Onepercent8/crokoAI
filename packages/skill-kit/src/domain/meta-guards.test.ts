import { describe, expect, it } from 'vitest';
import { asCents } from './money.js';
import { assertCampaignSpecSafe, buildLinkDataPicture } from './meta-guards.js';

const base = {
  status: 'PAUSED',
  objective: 'OUTCOME_TRAFFIC',
  daily_budget_cents: asCents(3000),
  daily_budget_cap_cents: asCents(5000),
  destination_type: 'WEBSITE',
};

describe('assertCampaignSpecSafe', () => {
  it('passes for a PAUSED, within-cap traffic campaign', () => {
    expect(() => assertCampaignSpecSafe(base)).not.toThrow();
  });

  it('rejects a non-PAUSED campaign (gotcha: born PAUSED)', () => {
    expect(() => assertCampaignSpecSafe({ ...base, status: 'ACTIVE' })).toThrow(/PAUSED/);
  });

  it('rejects a budget above the cap', () => {
    expect(() => assertCampaignSpecSafe({ ...base, daily_budget_cents: asCents(9000) })).toThrow(
      /exceeds/,
    );
  });

  it('rejects OUTCOME_SALES that still carries destination_type', () => {
    expect(() => assertCampaignSpecSafe({ ...base, objective: 'OUTCOME_SALES' })).toThrow(
      /destination_type/,
    );
  });

  it('allows OUTCOME_SALES when destination_type is omitted', () => {
    const { destination_type: _omit, ...rest } = base;
    expect(() => assertCampaignSpecSafe({ ...rest, objective: 'OUTCOME_SALES' })).not.toThrow();
  });
});

describe('buildLinkDataPicture', () => {
  it('builds inline picture for an https public url', () => {
    expect(buildLinkDataPicture('https://x.supabase.co/ad-ingest/a.png')).toEqual({
      picture: 'https://x.supabase.co/ad-ingest/a.png',
    });
  });

  it('rejects a non-https url', () => {
    expect(() => buildLinkDataPicture('http://insecure/a.png')).toThrow();
  });
});
