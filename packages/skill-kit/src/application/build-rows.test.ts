import { describe, expect, it } from 'vitest';
import { asCents } from '../domain/money.js';
import {
  buildAdRow,
  buildAdSetRow,
  buildCampaignRow,
  buildCreativeRow,
  buildGeneratedImageRow,
} from './build-rows.js';

describe('build-rows', () => {
  it('campaign row is always PAUSED and keeps raw_spec + cents', () => {
    const row = buildCampaignRow({
      client_id: 'c1',
      meta_campaign_id: 'camp_1',
      objective: 'OUTCOME_TRAFFIC',
      budget_mode: 'CBO',
      daily_budget_cents: asCents(3000),
      raw_spec: { hello: 'world' },
    });
    expect(row.status).toBe('PAUSED');
    expect(row.daily_budget_cents).toBe(3000);
    expect(row.raw_spec).toEqual({ hello: 'world' });
    expect(row.special_ad_categories).toEqual([]);
  });

  it('ad_set row includes destination_type for traffic', () => {
    const row = buildAdSetRow({
      campaign_id: 'camp_1',
      meta_ad_set_id: 'set_1',
      optimization_goal: 'LANDING_PAGE_VIEWS',
      billing_event: 'IMPRESSIONS',
      destination_type: 'WEBSITE',
      targeting: {},
      raw_spec: {},
    });
    expect(row.destination_type).toBe('WEBSITE');
  });

  it('ad_set row omits destination_type when not provided', () => {
    const row = buildAdSetRow({
      campaign_id: 'camp_1',
      meta_ad_set_id: 'set_1',
      optimization_goal: 'LANDING_PAGE_VIEWS',
      billing_event: 'IMPRESSIONS',
      targeting: {},
      raw_spec: {},
    });
    expect('destination_type' in row).toBe(false);
  });

  it('creative row carries image_url + raw_spec; description optional', () => {
    const row = buildCreativeRow({
      meta_creative_id: 'cr_1',
      angle: 'oferta',
      headline: 'H',
      primary_text: 'body',
      call_to_action_type: 'LEARN_MORE',
      link_url: 'https://example.com/lp',
      image_url: 'https://x/ad-ingest/a.png',
      page_id: 'page_1',
      generated_image_id: 'img_1',
      raw_spec: { angle: 'oferta' },
    });
    expect(row.image_url).toBe('https://x/ad-ingest/a.png');
    expect('description' in row).toBe(false);
    expect(row.raw_spec).toEqual({ angle: 'oferta' });
  });

  it('ad row links a creative', () => {
    const row = buildAdRow({
      ad_set_id: 'set_1',
      meta_ad_id: 'ad_1',
      creative_id: 'cr_1',
      effective_status: 'PAUSED',
      raw_spec: {},
    });
    expect(row.creative_id).toBe('cr_1');
  });

  it('generated_image row targets the public ad-ingest bucket', () => {
    const row = buildGeneratedImageRow({
      storage_bucket: 'ad-ingest',
      storage_path: 'cliente-exemplo/curso-exemplo/abc123.png',
      width: 1024,
      height: 1024,
      model: 'gpt-image-2',
      prompt: 'a clean product shot',
      aspect: '1:1',
      cost_usd_estimate: 0.04,
      raw_spec: {},
    });
    expect(row.storage_bucket).toBe('ad-ingest');
  });
});
