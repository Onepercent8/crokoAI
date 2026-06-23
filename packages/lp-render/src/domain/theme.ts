import { z } from 'zod';

/**
 * Theme — visual identity of a landing page (SPEC-011 / ADR 0013).
 *
 * Serialized to `theme.css` as CSS custom properties. Pure domain: no I/O.
 * Colors are kept as opaque strings (CSS color tokens) and are validated only
 * for shape, never interpreted — the renderer escapes/normalizes them.
 */

/** Restricted charset for CSS color values: hex, rgb(a)/hsl(a) and a few keywords. */
const cssColor = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|[a-zA-Z]+)$/,
    'invalid CSS color token',
  );

export const PaletteSchema = z.object({
  primary: cssColor,
  secondary: cssColor,
  background: cssColor,
  foreground: cssColor,
  accent: cssColor,
});

/** Restricted charset for a font-family token (avoids CSS injection in theme.css). */
const fontToken = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9 _,'"-]+$/, 'invalid font-family token');

export const TypographySchema = z.object({
  headingFont: fontToken,
  bodyFont: fontToken,
});

export const RADIUS_SCALE = ['none', 'sm', 'md', 'lg', 'full'] as const;
export const SHADOW_SCALE = ['none', 'sm', 'md', 'lg'] as const;

export const ThemeSchema = z.object({
  palette: PaletteSchema,
  typography: TypographySchema,
  radius: z.enum(RADIUS_SCALE),
  shadow: z.enum(SHADOW_SCALE),
});

export type Palette = z.infer<typeof PaletteSchema>;
export type Typography = z.infer<typeof TypographySchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type RadiusScale = (typeof RADIUS_SCALE)[number];
export type ShadowScale = (typeof SHADOW_SCALE)[number];

/**
 * Default theme — Croko brand identity (design-system/croko/MASTER.md): dark,
 * premium, teal primary + green action over ink, Clash Display / Satoshi.
 * Used as the starting Theme for generated landing pages; fully overridable per LP.
 * Parsed at module load so an invalid token fails the build, not at runtime.
 */
export const DEFAULT_THEME: Theme = ThemeSchema.parse({
  palette: {
    primary: '#0a6e75', // teal
    secondary: '#c1e1c2', // green-soft
    background: '#1c1c1c', // ink
    foreground: '#e1e1e1', // paper
    accent: '#57cc99', // green (action)
  },
  typography: {
    headingFont: 'Clash Display',
    bodyFont: 'Satoshi',
  },
  radius: 'lg',
  shadow: 'md',
});
