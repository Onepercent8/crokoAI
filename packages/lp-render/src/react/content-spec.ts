import { z } from 'zod';
import { SectionTypeSchema, SECTION_FIELD_SCHEMAS, type SectionType } from '../domain/sections.js';

/**
 * content-spec.json contract (read at build time by `landing-pages/_template`).
 *
 * The serializer (`domain/serializer.ts`) emits this shape; the React renderer
 * (`react/landing-page.tsx`) reads it. Both validate against this schema so the
 * build artifact is treated as DATA, never trusted blindly (SPEC-000 §11).
 *
 * Pure domain: no I/O. The artifact itself is produced/consumed by callers.
 */

/** One section entry as emitted into content-spec.json (enabled sections only). */
export const ContentSpecSectionSchema = z.object({
  type: SectionTypeSchema,
  position: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  key: z.string().min(1),
  // `fields` is validated per-type below by `parseContentSpec`.
  fields: z.unknown(),
});

export const ContentSpecSchema = z.object({
  locale: z.literal('pt'),
  noindex: z.boolean(),
  title: z.string().min(1),
  metaDescription: z.string().optional(),
  checkoutUrl: z.string().url().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  priceDisplay: z.string().optional(),
  sections: z.array(ContentSpecSectionSchema),
});

export type RawContentSpec = z.infer<typeof ContentSpecSchema>;

/** A content-spec section with `fields` refined against its per-type schema. */
export type ContentSpecSection = {
  [K in SectionType]: {
    type: K;
    position: number;
    version: number;
    key: string;
    fields: z.infer<(typeof SECTION_FIELD_SCHEMAS)[K]>;
  };
}[SectionType];

export interface ContentSpec {
  locale: 'pt';
  noindex: boolean;
  title: string;
  metaDescription?: string;
  checkoutUrl?: string;
  priceCents?: number;
  priceDisplay?: string;
  sections: ContentSpecSection[];
}

/**
 * Parse + fully validate a content-spec value (e.g. the parsed content-spec.json).
 * Each section's `fields` is refined against `SECTION_FIELD_SCHEMAS[type]`, so an
 * unknown field or type fails here rather than at render time. Throws on error.
 */
export function parseContentSpec(input: unknown): ContentSpec {
  const base = ContentSpecSchema.parse(input);
  const sections: ContentSpecSection[] = base.sections
    .map((section) => {
      const schema = SECTION_FIELD_SCHEMAS[section.type];
      const fields = schema.parse(section.fields);
      return {
        type: section.type,
        position: section.position,
        version: section.version,
        key: section.key,
        fields,
      } as ContentSpecSection;
    })
    .sort((a, b) => a.position - b.position);

  return {
    locale: base.locale,
    noindex: base.noindex,
    title: base.title,
    ...(base.metaDescription !== undefined ? { metaDescription: base.metaDescription } : {}),
    ...(base.checkoutUrl !== undefined ? { checkoutUrl: base.checkoutUrl } : {}),
    ...(base.priceCents !== undefined ? { priceCents: base.priceCents } : {}),
    ...(base.priceDisplay !== undefined ? { priceDisplay: base.priceDisplay } : {}),
    sections,
  };
}
