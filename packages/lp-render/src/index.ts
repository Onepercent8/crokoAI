/**
 * @template/lp-render — single source of truth for landing-page domain types,
 * the closed catalog of 17 sections, the ContentDoc serializer, and the pure
 * presentation-domain libs (checkout/affiliate/utm/consent).
 *
 * Pure domain: no I/O, no network. Imported by the runner skills, the
 * `landing-pages/_template` build, and the dashboard editor (ADR 0017).
 */

// Domain types & schemas
export {
  ThemeSchema,
  PaletteSchema,
  TypographySchema,
  RADIUS_SCALE,
  SHADOW_SCALE,
  DEFAULT_THEME,
  type Theme,
  type Palette,
  type Typography,
  type RadiusScale,
  type ShadowScale,
} from './domain/theme.js';

export { SettingsSchema, type Settings } from './domain/settings.js';

export {
  SECTION_TYPES,
  SectionTypeSchema,
  SECTION_FIELD_SCHEMAS,
  RawSectionSchema,
  parseSectionFields,
  type SectionType,
  type Section,
  type SectionFields,
  type RawSection,
} from './domain/sections.js';

export {
  ContentDocSchema,
  parseContentDoc,
  safeParseContentDoc,
  type ContentDoc,
} from './domain/content-doc.js';

// Serializer
export {
  serialize,
  formatCentsBRL,
  ARTIFACT_NAMES,
  type SerializedArtifacts,
} from './domain/serializer.js';

// Presentation-domain libs
export {
  UTM_KEYS,
  normalizeUtmValue,
  normalizeUtmParams,
  applyUtm,
  extractUtm,
  type UtmKey,
  type UtmParams,
} from './lib/utm.js';

export {
  DEFAULT_AFFILIATE_PARAM,
  isValidAffiliateCode,
  normalizeAffiliateCode,
  applyAffiliate,
  extractAffiliate,
} from './lib/affiliate.js';

export { buildCheckoutUrl, type CheckoutParams } from './lib/checkout.js';

export {
  CONSENT_CATEGORIES,
  initialConsent,
  grantAll,
  denyAll,
  updateConsent,
  isAllowed,
  type ConsentCategory,
  type ConsentDecision,
  type ConsentState,
} from './lib/consent.js';
