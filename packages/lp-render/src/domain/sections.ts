import { z } from 'zod';

/**
 * Section catalog — the closed vocabulary of 17 landing-page section types
 * (SPEC-000 §6 `landing_page_sections.type`, SPEC-011, ADR 0013).
 *
 * The IA (architect/copywriter) and the dashboard editor may only emit sections
 * whose `type` is in this enum and whose `fields` satisfy the per-type schema in
 * `SECTION_FIELD_SCHEMAS`. Anything outside the catalog or outside a field schema
 * is rejected at the boundary (security: input is data, not instruction — §11).
 *
 * Pure domain: no I/O, no rendering. The `_template` provides one render
 * component per section type; this module is the single source of validation.
 */

export const SECTION_TYPES = [
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
] as const;

export const SectionTypeSchema = z.enum(SECTION_TYPES);
export type SectionType = z.infer<typeof SectionTypeSchema>;

// --- Reusable field primitives -------------------------------------------------

/** Non-empty, trimmed, length-bounded display string. */
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional bounded display string (may be omitted). */
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
/** A URL field. Kept as a string and validated as a URL at the boundary. */
const url = z.string().url();
/** Restricted call-to-action descriptor reused by several sections. */
const ctaLink = z.object({
  label: text(60),
  href: url,
});

// --- Per-type field schemas (closed catalog) ----------------------------------

const heroFields = z.object({
  eyebrow: optionalText(80),
  headline: text(160),
  subheadline: optionalText(280),
  primaryCta: ctaLink,
  secondaryCta: ctaLink.optional(),
  imageUrl: url.optional(),
});

const logoCloudFields = z.object({
  title: optionalText(120),
  logos: z
    .array(
      z.object({
        alt: text(80),
        imageUrl: url,
      }),
    )
    .min(1)
    .max(12),
});

const benefitsFields = z.object({
  title: text(160),
  subtitle: optionalText(280),
  items: z
    .array(
      z.object({
        title: text(120),
        description: text(400),
        icon: optionalText(48),
      }),
    )
    .min(1)
    .max(12),
});

const featuresFields = z.object({
  title: text(160),
  subtitle: optionalText(280),
  items: z
    .array(
      z.object({
        title: text(120),
        description: text(400),
        imageUrl: url.optional(),
      }),
    )
    .min(1)
    .max(12),
});

const howItWorksFields = z.object({
  title: text(160),
  steps: z
    .array(
      z.object({
        step: z.number().int().positive(),
        title: text(120),
        description: text(400),
      }),
    )
    .min(1)
    .max(10),
});

const socialProofFields = z.object({
  title: optionalText(160),
  quote: text(500),
  author: text(120),
  role: optionalText(120),
  avatarUrl: url.optional(),
});

const testimonialsFields = z.object({
  title: text(160),
  items: z
    .array(
      z.object({
        quote: text(500),
        author: text(120),
        role: optionalText(120),
        avatarUrl: url.optional(),
        rating: z.number().int().min(1).max(5).optional(),
      }),
    )
    .min(1)
    .max(12),
});

const statsFields = z.object({
  title: optionalText(160),
  items: z
    .array(
      z.object({
        value: text(40),
        label: text(120),
      }),
    )
    .min(1)
    .max(8),
});

const pricingFields = z.object({
  title: text(160),
  subtitle: optionalText(280),
  plans: z
    .array(
      z.object({
        name: text(80),
        /** Price in integer cents. Never a float. */
        priceCents: z.number().int().nonnegative(),
        period: optionalText(40),
        features: z.array(text(160)).min(1).max(16),
        cta: ctaLink,
        highlighted: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(4),
});

const offerFields = z.object({
  title: text(160),
  description: text(500),
  /** Current price in integer cents. */
  priceCents: z.number().int().nonnegative(),
  /** Optional crossed-out anchor price in integer cents (must be >= priceCents at validation site). */
  compareAtPriceCents: z.number().int().nonnegative().optional(),
  cta: ctaLink,
  /** Optional ISO-8601 deadline string for scarcity (validated as datetime). */
  deadline: z.string().datetime().optional(),
});

const guaranteeFields = z.object({
  title: text(160),
  description: text(500),
  badgeUrl: url.optional(),
  days: z.number().int().positive().max(3650).optional(),
});

const faqFields = z.object({
  title: text(160),
  items: z
    .array(
      z.object({
        question: text(280),
        answer: text(1200),
      }),
    )
    .min(1)
    .max(30),
});

const aboutFields = z.object({
  title: text(160),
  body: text(2000),
  imageUrl: url.optional(),
});

const leadFormFields = z.object({
  title: text(160),
  subtitle: optionalText(280),
  submitLabel: text(60),
  /** Where the form posts. Kept restricted to a URL at the boundary. */
  action: url,
  fields: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{0,39}$/, 'invalid field name'),
        label: text(80),
        type: z.enum(['text', 'email', 'tel', 'textarea']),
        required: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(8),
  consentText: optionalText(400),
});

const ctaFields = z.object({
  title: text(160),
  subtitle: optionalText(280),
  cta: ctaLink,
});

const videoFields = z.object({
  title: optionalText(160),
  /** Embeddable video URL. */
  videoUrl: url,
  posterUrl: url.optional(),
  caption: optionalText(280),
});

const footerFields = z.object({
  companyName: text(120),
  tagline: optionalText(200),
  links: z
    .array(
      z.object({
        label: text(60),
        href: url,
      }),
    )
    .max(20)
    .default([]),
  legalText: optionalText(400),
});

/**
 * Single source of truth mapping each section `type` to its `fields` schema.
 * `.strict()` is applied so that unknown keys are rejected (closed catalog).
 */
export const SECTION_FIELD_SCHEMAS = {
  hero: heroFields.strict(),
  logo_cloud: logoCloudFields.strict(),
  benefits: benefitsFields.strict(),
  features: featuresFields.strict(),
  how_it_works: howItWorksFields.strict(),
  social_proof: socialProofFields.strict(),
  testimonials: testimonialsFields.strict(),
  stats: statsFields.strict(),
  pricing: pricingFields.strict(),
  offer: offerFields.strict(),
  guarantee: guaranteeFields.strict(),
  faq: faqFields.strict(),
  about: aboutFields.strict(),
  lead_form: leadFormFields.strict(),
  cta: ctaFields.strict(),
  video: videoFields.strict(),
  footer: footerFields.strict(),
} as const satisfies Record<SectionType, z.ZodTypeAny>;

/** Map of section type -> its parsed `fields` type. */
export type SectionFields = {
  [K in SectionType]: z.infer<(typeof SECTION_FIELD_SCHEMAS)[K]>;
};

/**
 * A validated section discriminated by `type`, with `fields` typed per the
 * catalog. Built from the raw `SectionSchema` after refinement.
 */
export type Section = {
  [K in SectionType]: {
    type: K;
    position: number;
    enabled: boolean;
    version: number;
    fields: SectionFields[K];
  };
}[SectionType];

/**
 * Raw section envelope before per-type field refinement. `fields` is unknown
 * here; `ContentDocSchema` refines each section against `SECTION_FIELD_SCHEMAS`.
 */
export const RawSectionSchema = z.object({
  type: SectionTypeSchema,
  position: z.number().int().nonnegative(),
  enabled: z.boolean().default(true),
  version: z.number().int().positive().default(1),
  fields: z.unknown(),
});

export type RawSection = z.infer<typeof RawSectionSchema>;

/**
 * Validate the `fields` of a single section against its per-type schema.
 * Throws (via `parse`) when the type is unknown or fields are invalid.
 */
export function parseSectionFields<T extends SectionType>(
  type: T,
  fields: unknown,
): SectionFields[T] {
  const schema = SECTION_FIELD_SCHEMAS[type];
  return schema.parse(fields) as SectionFields[T];
}
