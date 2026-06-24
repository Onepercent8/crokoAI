import { SECTION_FIELD_SCHEMAS, type SectionType } from '@template/lp-render';
import { z } from 'zod';

/**
 * edit-fields — derive a flat list of editable leaf fields from a section's Zod
 * schema, so the editor UI can render one input per scalar field with a stable
 * dotted `path` (SPEC-012). Pure helper (no React, no I/O) so it is unit-testable
 * and shared by the form component and tests.
 *
 * We do not hand-maintain a parallel field list: the schemas in
 * `@template/lp-render` are the single source of truth (ADR 0017). This walks
 * the schema shape and the current values to produce the leaf descriptors.
 */

export type LeafKind = 'string' | 'number' | 'boolean';

export interface LeafField {
  /** Dotted edit-path into `fields` (e.g. `primaryCta.label`, `items.0.title`). */
  path: string;
  /** Human label (last path segment, de-cased). */
  label: string;
  kind: LeafKind;
  /** Current value at this path (string/number/boolean), if present. */
  value: string | number | boolean | undefined;
  /** True when the field carries integer cents (render as currency). */
  isCents: boolean;
}

/** De-case a path segment into a readable label (`priceCents` → `Price Cents`). */
function labelFor(segment: string): string {
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A path segment carrying money in integer cents (render/validate as currency). */
function isCentsSegment(segment: string): boolean {
  return /cents$/i.test(segment);
}

/**
 * Recursively collect leaf fields from a concrete value tree. We walk VALUES
 * (not the schema) so arrays expand to their actual indices; the schema still
 * governs validation server-side. Unknown/object leaves are skipped.
 */
function collectFromValue(value: unknown, prefix: string, out: LeafField[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFromValue(item, `${prefix}.${index}`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      collectFromValue(child, path, out);
    }
    return;
  }
  const lastSegment = prefix.split('.').pop() ?? prefix;
  if (typeof value === 'string') {
    out.push({ path: prefix, label: labelFor(lastSegment), kind: 'string', value, isCents: false });
  } else if (typeof value === 'number') {
    out.push({
      path: prefix,
      label: labelFor(lastSegment),
      kind: 'number',
      value,
      isCents: isCentsSegment(lastSegment),
    });
  } else if (typeof value === 'boolean') {
    out.push({
      path: prefix,
      label: labelFor(lastSegment),
      kind: 'boolean',
      value,
      isCents: false,
    });
  }
}

/**
 * Build the leaf-field list for a section's current `fields`. Validates that the
 * type is in the catalog (returns `[]` for an unknown type — deny-by-default).
 */
export function deriveLeafFields(type: SectionType, fields: Record<string, unknown>): LeafField[] {
  if (!(type in SECTION_FIELD_SCHEMAS)) {
    return [];
  }
  const out: LeafField[] = [];
  collectFromValue(fields, '', out);
  return out;
}

/**
 * Coerce a form input string back to the type the schema expects for `kind`.
 * For cents, the input is in major units (e.g. reais) and converted to integer
 * cents — money is ALWAYS integer cents server-side (never float).
 */
export function coerceInput(
  kind: LeafKind,
  isCents: boolean,
  raw: string,
): string | number | boolean {
  if (kind === 'boolean') {
    return raw === 'true' || raw === 'on';
  }
  if (kind === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) {
      return raw; // let the server schema reject it
    }
    return isCents ? Math.round(n * 100) : n;
  }
  return raw;
}

/** Format integer cents as a major-unit string for display in a currency input. */
export function centsToMajor(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Client-side pre-check: a single leaf value against a tiny local guard. */
export const LeafValueSchema = z.union([z.string(), z.number(), z.boolean()]);
