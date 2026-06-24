import { describe, expect, it } from 'vitest';

import {
  applyFieldEdit,
  checkVersion,
  editOutcomeStatus,
  getByPath,
  parsePath,
  reconcile,
  reconcileReplace,
  schemaFor,
  setByPath,
  type EditRequest,
  type LandingEditorRepository,
  type SectionRow,
} from '../lib/api/landing-pages';

/** A valid `offer` section (money in integer cents). */
function offerFields(): Record<string, unknown> {
  return {
    title: 'Oferta',
    description: 'Descrição da oferta para o teste.',
    priceCents: 9900,
    cta: { label: 'Comprar', href: 'https://example.com/checkout' },
  };
}

/** A valid `hero` section. */
function heroFields(): Record<string, unknown> {
  return {
    headline: 'Headline inicial',
    primaryCta: { label: 'Começar', href: 'https://example.com/start' },
  };
}

describe('edit-path: parsePath / setByPath / getByPath', () => {
  it('rejects __proto__ / constructor / prototype path segments', () => {
    expect(() => parsePath('__proto__')).toThrow();
    expect(() => parsePath('a.__proto__.b')).toThrow();
    expect(() => parsePath('constructor')).toThrow();
    expect(() => parsePath('a.prototype')).toThrow();
  });

  it('rejects an over-deep path', () => {
    expect(() => parsePath('a.b.c.d.e.f.g.h.i')).toThrow(/too deep/);
  });

  it('rejects malformed charset (brackets/spaces/dashes)', () => {
    expect(() => parsePath('a[0]')).toThrow();
    expect(() => parsePath('a b')).toThrow();
    expect(() => parsePath('a-b')).toThrow();
  });

  it('sets a nested value without mutating the source (pure)', () => {
    const src = heroFields();
    const next = setByPath(src, 'primaryCta.label', 'Novo');
    expect((next.primaryCta as { label: string }).label).toBe('Novo');
    expect((src.primaryCta as { label: string }).label).toBe('Começar'); // unchanged
  });

  it('sets an array index, creating the array when absent', () => {
    const out = setByPath({}, 'items.0.title', 'X');
    expect(Array.isArray(out.items)).toBe(true);
    expect((out.items as Array<{ title: string }>)[0]?.title).toBe('X');
  });

  it('reads a value by path and returns undefined for a missing one', () => {
    const f = heroFields();
    expect(getByPath(f, 'primaryCta.label')).toBe('Começar');
    expect(getByPath(f, 'subheadline')).toBeUndefined();
  });

  it('setByPath never injects onto Object.prototype', () => {
    // Even though parsePath blocks it, prove no global pollution can occur.
    expect(() => setByPath({}, '__proto__.polluted', true)).toThrow();
    // @ts-expect-error — runtime probe
    expect({}.polluted).toBeUndefined();
  });
});

describe('schemaFor: deny-by-default', () => {
  it('returns a schema for a known type', () => {
    expect(schemaFor('offer')).not.toBeNull();
    expect(schemaFor('hero')).not.toBeNull();
  });
  it('returns null for an unknown type', () => {
    expect(schemaFor('unknown_section')).toBeNull();
    expect(schemaFor('__proto__')).toBeNull();
  });
});

describe('reconcile: whole-section validation', () => {
  it('accepts a valid single-field patch and returns the next fields', () => {
    const edit: EditRequest = {
      sectionType: 'hero',
      path: 'headline',
      value: 'Outra headline',
      expectedVersion: 1,
    };
    const res = reconcile(heroFields(), edit);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.next as { headline: string }).headline).toBe('Outra headline');
    }
  });

  it('rejects a patch that breaks the whole-section schema', () => {
    const edit: EditRequest = {
      sectionType: 'hero',
      path: 'headline',
      value: '', // min(1) fails
      expectedVersion: 1,
    };
    const res = reconcile(heroFields(), edit);
    expect(res.ok).toBe(false);
  });

  it('rejects money written as a float (cents must be integer)', () => {
    const edit: EditRequest = {
      sectionType: 'offer',
      path: 'priceCents',
      value: 99.5, // not an integer
      expectedVersion: 1,
    };
    const res = reconcile(offerFields(), edit);
    expect(res.ok).toBe(false);
  });

  it('accepts integer cents for money', () => {
    const edit: EditRequest = {
      sectionType: 'offer',
      path: 'priceCents',
      value: 12345,
      expectedVersion: 1,
    };
    const res = reconcile(offerFields(), edit);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown section type', () => {
    const edit = {
      sectionType: 'nope',
      path: 'a',
      value: 'x',
      expectedVersion: 1,
    } as unknown as EditRequest;
    const res = reconcile({}, edit);
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown extra key (strict catalog)', () => {
    const edit: EditRequest = {
      sectionType: 'hero',
      path: 'unexpectedField',
      value: 'x',
      expectedVersion: 1,
    };
    const res = reconcile(heroFields(), edit);
    expect(res.ok).toBe(false);
  });
});

describe('reconcileReplace: whole-object validation', () => {
  it('accepts a valid full section', () => {
    const res = reconcileReplace({
      sectionType: 'offer',
      fields: offerFields(),
      expectedVersion: 2,
    });
    expect(res.ok).toBe(true);
  });
  it('rejects an invalid full section', () => {
    const res = reconcileReplace({
      sectionType: 'offer',
      fields: { title: 'x' },
      expectedVersion: 2,
    });
    expect(res.ok).toBe(false);
  });
});

describe('checkVersion + editOutcomeStatus', () => {
  it('matches equal versions, conflicts on mismatch', () => {
    expect(checkVersion(3, 3)).toEqual({ ok: true });
    expect(checkVersion(2, 3)).toEqual({ ok: false, reason: 'conflict' });
  });
  it('maps outcomes to HTTP status codes', () => {
    expect(
      editOutcomeStatus({ status: 'updated', section: { type: 'hero', fields: {}, version: 2 } }),
    ).toBe(200);
    expect(editOutcomeStatus({ status: 'conflict' })).toBe(409);
    expect(editOutcomeStatus({ status: 'invalid', issues: [] })).toBe(422);
    expect(editOutcomeStatus({ status: 'not_found' })).toBe(404);
    expect(editOutcomeStatus({ status: 'locked' })).toBe(423);
  });
});

// --- Integration: applyFieldEdit over a fake repository ----------------------

class FakeRepo implements LandingEditorRepository {
  applied: Array<{ type: string; fields: Record<string, unknown>; version: number }> = [];
  constructor(
    private draftStatus: string | null,
    private section: SectionRow | null,
    private readonly raceVersion = false,
  ) {}
  async getDraftStatus(): Promise<string | null> {
    return this.draftStatus;
  }
  async getSection(): Promise<SectionRow | null> {
    return this.section;
  }
  async applyEdit(input: {
    type: string;
    fields: Record<string, unknown>;
    expectedVersion: number;
  }): Promise<{ version: number } | null> {
    if (this.raceVersion) {
      return null; // simulate a concurrent writer winning the race
    }
    const version = input.expectedVersion + 1;
    this.applied.push({ type: input.type, fields: input.fields, version });
    return { version };
  }
}

const baseSection: SectionRow = { fields: heroFields(), version: 1, enabled: true, position: 0 };

describe('applyFieldEdit: synchronous draft edit', () => {
  const edit: EditRequest = {
    sectionType: 'hero',
    path: 'headline',
    value: 'Editado',
    expectedVersion: 1,
  };

  it('updates fields and bumps version on the happy path', async () => {
    const repo = new FakeRepo('ready', baseSection);
    const out = await applyFieldEdit(repo, 'p1', edit);
    expect(out.status).toBe('updated');
    if (out.status === 'updated') {
      expect(out.section.version).toBe(2);
      expect((out.section.fields as { headline: string }).headline).toBe('Editado');
    }
    expect(repo.applied).toHaveLength(1);
  });

  it('returns conflict when expectedVersion is stale (no write)', async () => {
    const repo = new FakeRepo('ready', { ...baseSection, version: 5 });
    const out = await applyFieldEdit(repo, 'p1', edit);
    expect(out.status).toBe('conflict');
    expect(repo.applied).toHaveLength(0);
  });

  it('returns conflict when the write loses the race (lost-update guard)', async () => {
    const repo = new FakeRepo('ready', baseSection, true);
    const out = await applyFieldEdit(repo, 'p1', edit);
    expect(out.status).toBe('conflict');
  });

  it('blocks edits while the page is publishing (locked)', async () => {
    const repo = new FakeRepo('publishing', baseSection);
    const out = await applyFieldEdit(repo, 'p1', edit);
    expect(out.status).toBe('locked');
    expect(repo.applied).toHaveLength(0);
  });

  it('returns not_found when the page or section is absent', async () => {
    expect((await applyFieldEdit(new FakeRepo(null, baseSection), 'p1', edit)).status).toBe(
      'not_found',
    );
    expect((await applyFieldEdit(new FakeRepo('ready', null), 'p1', edit)).status).toBe(
      'not_found',
    );
  });

  it('rejects an invalid value with 422 before persisting', async () => {
    const repo = new FakeRepo('ready', baseSection);
    const out = await applyFieldEdit(repo, 'p1', { ...edit, value: '' });
    expect(out.status).toBe('invalid');
    expect(repo.applied).toHaveLength(0);
  });
});
