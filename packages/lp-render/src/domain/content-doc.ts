import { z } from 'zod';
import { SettingsSchema } from './settings.js';
import { ThemeSchema } from './theme.js';
import { RawSectionSchema, SECTION_FIELD_SCHEMAS, type Section } from './sections.js';

/**
 * ContentDoc — the canonical, validated representation of a landing page
 * (SPEC-011 / ADR 0013/0017). Pure domain: no I/O, no rendering.
 *
 * A `ContentDoc` maps to the database as:
 *   settings/theme  -> landing_pages.settings / landing_pages.theme
 *   sections[]      -> landing_page_sections (one row per section)
 *
 * Validation is two-stage:
 *   1. Shape of settings/theme and the raw section envelope.
 *   2. Per-section refinement of `fields` against SECTION_FIELD_SCHEMAS, plus
 *      structural invariants (>=1 section, unique types, unique positions).
 */

const RawContentDocSchema = z.object({
  settings: SettingsSchema,
  theme: ThemeSchema,
  sections: z.array(RawSectionSchema).min(1),
});

export const ContentDocSchema = RawContentDocSchema.transform((doc, ctx) => {
  const seenTypes = new Set<string>();
  const seenPositions = new Set<number>();
  const sections: Section[] = [];

  doc.sections.forEach((raw, index) => {
    // Closed catalog: (landing_page_id, type) is unique — reject duplicate types.
    if (seenTypes.has(raw.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'type'],
        message: `duplicate section type "${raw.type}" (each type may appear at most once)`,
      });
    }
    seenTypes.add(raw.type);

    if (seenPositions.has(raw.position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'position'],
        message: `duplicate section position ${raw.position}`,
      });
    }
    seenPositions.add(raw.position);

    const fieldSchema = SECTION_FIELD_SCHEMAS[raw.type];
    const parsed = fieldSchema.safeParse(raw.fields);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ['sections', index, 'fields', ...issue.path],
        });
      }
      return;
    }

    sections.push({
      type: raw.type,
      position: raw.position,
      enabled: raw.enabled,
      version: raw.version,
      // Field shape is guaranteed by the per-type schema above.
      fields: parsed.data,
    } as Section);
  });

  return {
    settings: doc.settings,
    theme: doc.theme,
    sections,
  };
});

export type ContentDoc = {
  settings: z.infer<typeof SettingsSchema>;
  theme: z.infer<typeof ThemeSchema>;
  sections: Section[];
};

/** Parse and fully validate a raw value into a `ContentDoc` (throws on error). */
export function parseContentDoc(input: unknown): ContentDoc {
  return ContentDocSchema.parse(input);
}

/** Non-throwing variant returning a Zod `SafeParseReturnType`. */
export function safeParseContentDoc(input: unknown) {
  return ContentDocSchema.safeParse(input);
}
