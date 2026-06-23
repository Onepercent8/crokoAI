import { describe, expect, it } from 'vitest';

import { allowedSlugs, isReadTool, resolveSkill } from '../lib/nexus/tools';

describe('nexus allowlist (slug -> skill)', () => {
  it('resolves every known slug to the expected skill name + kind', () => {
    expect(resolveSkill('create')).toEqual({
      slug: 'create',
      skill: 'create-traffic-cliente-exemplo-campaign',
      kind: 'create',
    });
    expect(resolveSkill('sales')?.kind).toBe('create_sales');
    expect(resolveSkill('analyze')?.skill).toBe('funnel-analytics-cliente-exemplo-campaign');
    expect(resolveSkill('publish')?.kind).toBe('landing_publish');
  });

  it('returns null for an unknown slug (free text never resolves)', () => {
    expect(resolveSkill('delete-everything')).toBeNull();
    expect(resolveSkill('create-traffic-cliente-exemplo-campaign')).toBeNull(); // skill name, not slug
    expect(resolveSkill('')).toBeNull();
    expect(resolveSkill('CREATE')).toBeNull(); // case-sensitive
  });

  it('exposes exactly the six allowlisted slugs', () => {
    expect(allowedSlugs().sort()).toEqual(
      ['activate', 'analyze', 'create', 'landing', 'publish', 'sales'].sort(),
    );
  });

  it('classifies read tools', () => {
    expect(isReadTool('list_campaigns')).toBe(true);
    expect(isReadTool('enqueue_skill')).toBe(false);
    expect(isReadTool('rm_rf')).toBe(false);
  });
});
