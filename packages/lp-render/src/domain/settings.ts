import { z } from 'zod';

/**
 * Settings — page-level configuration of a landing page (SPEC-011).
 *
 * Money is always an integer number of cents (`priceCents`); never a float.
 * `noindex` defaults to `true`: a freshly created page is a preview and must
 * not be indexed until a manual go-live (SPEC-000 §6).
 */
export const SettingsSchema = z.object({
  locale: z.literal('pt'),
  title: z.string().trim().min(1).max(120),
  metaDescription: z.string().trim().max(320).optional(),
  noindex: z.boolean().default(true),
  checkoutUrl: z.string().url().optional(),
  /** Price in integer cents (e.g. R$ 197,00 => 19700). Never a float. */
  priceCents: z.number().int().nonnegative().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
