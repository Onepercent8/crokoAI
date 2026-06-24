import { describe, expect, it } from 'vitest';
import { asCents } from './money.js';
import {
  assertActivationSafe,
  assertCampaignSpecSafe,
  buildLinkDataPicture,
  type ActivationContext,
  type ActivationProbe,
} from './meta-guards.js';

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

describe('assertActivationSafe (fail-closed revalidation)', () => {
  const probe: ActivationProbe = {
    meta_entity_id: 'cmp_1',
    ad_account_id: 'act_123',
    status: 'PAUSED',
    daily_budget_cents: asCents(3000),
  };
  const context: ActivationContext = {
    client_ad_account_id: 'act_123',
    daily_budget_cap_cents: asCents(5000),
    intended_entity_id: 'cmp_1',
  };

  it('passes when the entity matches, is PAUSED and within the cap', () => {
    expect(() => assertActivationSafe(probe, context)).not.toThrow();
  });

  it('aborts when the probed entity is not the intended target (no swap)', () => {
    expect(() => assertActivationSafe({ ...probe, meta_entity_id: 'cmp_other' }, context)).toThrow(
      /intended target/,
    );
  });

  it('aborts when the entity belongs to a different ad account (cross-client)', () => {
    expect(() => assertActivationSafe({ ...probe, ad_account_id: 'act_999' }, context)).toThrow(
      /different ad account/,
    );
  });

  it('aborts when the entity is not PAUSED', () => {
    expect(() => assertActivationSafe({ ...probe, status: 'ACTIVE' }, context)).toThrow(
      /must be PAUSED/,
    );
  });

  it('aborts when the current budget exceeds the client cap', () => {
    expect(() =>
      assertActivationSafe({ ...probe, daily_budget_cents: asCents(9000) }, context),
    ).toThrow(/exceeds/);
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
