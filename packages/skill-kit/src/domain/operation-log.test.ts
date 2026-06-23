import { describe, expect, it } from 'vitest';
import { buildOperationLog } from './operation-log.js';

describe('buildOperationLog', () => {
  it('builds a valid create row', () => {
    const row = buildOperationLog({
      entity_type: 'campaign',
      entity_id: 'camp_1',
      action: 'create',
      actor: 'skill:create-traffic',
      summary: 'Created PAUSED traffic campaign',
    });
    expect(row.action).toBe('create');
    expect(row.entity_type).toBe('campaign');
  });

  it('rejects an empty entity_id', () => {
    expect(() =>
      buildOperationLog({
        entity_type: 'ad',
        entity_id: '',
        action: 'create',
        actor: 'skill:create-traffic',
        summary: 'x',
      }),
    ).toThrow();
  });

  it('rejects an unknown action', () => {
    expect(() =>
      buildOperationLog({
        entity_type: 'ad',
        entity_id: 'ad_1',
        // @ts-expect-error invalid action on purpose
        action: 'explode',
        actor: 'skill:create-traffic',
        summary: 'x',
      }),
    ).toThrow();
  });
});
