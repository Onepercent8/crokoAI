import { describe, expect, it } from 'vitest';
import {
  assertAllAnglesCovered,
  CopyOutputSchema,
  CreateTrafficArgsSchema,
  ProductBriefSchema,
  ScrapeFactsSchema,
} from './schemas.js';

const validBrief = {
  client_slug: 'cliente-exemplo',
  product_slug: 'curso-exemplo',
  name: 'Curso Exemplo',
  landing_url: 'https://example.com/curso-exemplo',
  price_cents: 19900,
  currency: 'BRL',
  objective: 'OUTCOME_TRAFFIC',
  call_to_action_type: 'LEARN_MORE',
};

describe('ProductBriefSchema', () => {
  it('accepts a valid brief', () => {
    expect(ProductBriefSchema.parse(validBrief).product_slug).toBe('curso-exemplo');
  });

  it('rejects a non-url landing', () => {
    expect(() => ProductBriefSchema.parse({ ...validBrief, landing_url: 'nope' })).toThrow();
  });

  it('rejects float money', () => {
    expect(() => ProductBriefSchema.parse({ ...validBrief, price_cents: 1.5 })).toThrow();
  });

  it('rejects an objective other than OUTCOME_TRAFFIC', () => {
    expect(() => ProductBriefSchema.parse({ ...validBrief, objective: 'OUTCOME_SALES' })).toThrow();
  });
});

describe('CreateTrafficArgsSchema', () => {
  it('defaults budget_mode to CBO', () => {
    const parsed = CreateTrafficArgsSchema.parse({
      client_slug: 'cliente-exemplo',
      product_slug: 'curso-exemplo',
    });
    expect(parsed.budget_mode).toBe('CBO');
  });

  it('rejects a bad slug charset', () => {
    expect(() =>
      CreateTrafficArgsSchema.parse({ client_slug: 'BAD slug', product_slug: 'x' }),
    ).toThrow();
  });

  it('rejects a non-positive budget override', () => {
    expect(() =>
      CreateTrafficArgsSchema.parse({
        client_slug: 'cliente-exemplo',
        product_slug: 'curso-exemplo',
        daily_budget_cents: 0,
      }),
    ).toThrow();
  });
});

describe('subagent outputs', () => {
  const angles = ['autoridade', 'dor', 'oferta'] as const;
  const copies = angles.map((angle) => ({
    angle,
    headline: `H ${angle}`,
    primary_text: `body ${angle}`,
  }));

  it('accepts exactly 3 copies covering all angles', () => {
    const parsed = CopyOutputSchema.parse(copies);
    expect(() => assertAllAnglesCovered(parsed)).not.toThrow();
  });

  it('rejects fewer than 3 copies', () => {
    expect(() => CopyOutputSchema.parse(copies.slice(0, 2))).toThrow();
  });

  it('detects a missing angle even at length 3', () => {
    const dup = [copies[0]!, copies[0]!, copies[1]!];
    expect(() => assertAllAnglesCovered(dup)).toThrow(/missing angle/);
  });

  it('rejects a headline over 40 chars', () => {
    expect(() =>
      CopyOutputSchema.parse([{ ...copies[0]!, headline: 'x'.repeat(41) }, copies[1]!, copies[2]!]),
    ).toThrow();
  });

  it('validates scrape facts as data', () => {
    const facts = ScrapeFactsSchema.parse({
      product_name: 'Curso Exemplo',
      promise: 'Aprenda X',
      pains: ['p1'],
      proof: ['proof1'],
      offer: 'oferta',
    });
    expect(facts.pains).toHaveLength(1);
  });
});
