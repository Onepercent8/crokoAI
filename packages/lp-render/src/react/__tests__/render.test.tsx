import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseContentDoc } from '../../domain/content-doc.js';
import { serialize } from '../../domain/serializer.js';
import { parseContentSpec } from '../content-spec.js';
import { LandingPage, sectionTypeOrder } from '../landing-page.js';
import { SECTION_COMPONENTS } from '../sections.js';
import { SECTION_TYPES } from '../../domain/sections.js';
import { allSectionsRawDoc } from './all-sections-fixture.js';

/**
 * React render layer — integration over the serializer + content-spec + components.
 * Renders to static markup (no DOM) so it stays a pure, fast unit suite.
 */

function renderSpecMarkup() {
  const doc = parseContentDoc(allSectionsRawDoc());
  const artifacts = serialize(doc);
  const spec = parseContentSpec(JSON.parse(artifacts['content-spec.json']));
  return { spec, html: renderToStaticMarkup(<LandingPage spec={spec} />) };
}

describe('react render layer', () => {
  it('has a component for every section type in the closed catalog', () => {
    for (const type of SECTION_TYPES) {
      expect(SECTION_COMPONENTS[type], `missing component for ${type}`).toBeTypeOf('function');
    }
    expect(Object.keys(SECTION_COMPONENTS).sort()).toEqual([...SECTION_TYPES].sort());
  });

  it('renders all 17 sections from a serialized content-spec', () => {
    const { spec, html } = renderSpecMarkup();
    expect(spec.sections).toHaveLength(17);
    for (const type of SECTION_TYPES) {
      expect(html, `section ${type} not rendered`).toContain(`data-section="${type}"`);
    }
  });

  it('renders sections in position order', () => {
    const { spec } = renderSpecMarkup();
    expect(sectionTypeOrder(spec)).toEqual([
      'hero',
      'logo_cloud',
      'benefits',
      'features',
      'how_it_works',
      'social_proof',
      'testimonials',
      'stats',
      'pricing',
      'offer',
      'guarantee',
      'faq',
      'about',
      'lead_form',
      'cta',
      'video',
      'footer',
    ]);
  });

  it('formats money from integer cents (BRL), never a float', () => {
    const { html } = renderSpecMarkup();
    expect(html).toContain('R$ 197,00');
    expect(html).toContain('R$ 297,00'); // compareAtPrice
    expect(html).not.toContain('197.00');
  });

  it('escapes content (no raw HTML injection from fields)', () => {
    const doc = parseContentDoc({
      ...allSectionsRawDoc(),
      sections: [
        {
          type: 'cta',
          position: 0,
          fields: {
            title: '<script>alert(1)</script>',
            cta: { label: 'Go', href: 'https://example.com/x' },
          },
        },
      ],
    });
    const spec = parseContentSpec(JSON.parse(serialize(doc)['content-spec.json']));
    const html = renderToStaticMarkup(<LandingPage spec={spec} />);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('parseContentSpec', () => {
  it('rejects an unknown section type', () => {
    expect(() =>
      parseContentSpec({
        locale: 'pt',
        noindex: true,
        title: 'x',
        sections: [{ type: 'banner', position: 0, version: 1, key: 'banner.0', fields: {} }],
      }),
    ).toThrow();
  });

  it('rejects unknown fields in a section (closed catalog)', () => {
    expect(() =>
      parseContentSpec({
        locale: 'pt',
        noindex: true,
        title: 'x',
        sections: [
          {
            type: 'cta',
            position: 0,
            version: 1,
            key: 'cta.0',
            fields: {
              title: 'ok',
              cta: { label: 'Go', href: 'https://example.com' },
              evil: 'extra',
            },
          },
        ],
      }),
    ).toThrow();
  });
});
