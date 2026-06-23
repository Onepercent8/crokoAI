import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContentSpec, type ContentSpec } from '@template/lp-render/react';

/**
 * Build-time content loader for the landing template (SPEC-011, Onda 8).
 *
 * Reads the serialized artifacts injected by the publish skill into `content/`
 * and validates content-spec.json against the closed-catalog schema. The build
 * artifact is DATA, not trusted instruction — an invalid spec fails the build
 * here, never reaches the rendered HTML (SPEC-000 §11).
 *
 * Static export: this runs at build time only; no runtime server.
 */

// Resolve relative to this module so the loader works from any cwd (build,
// vitest run from the repo root, or from the package dir).
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');

export function loadContentSpec(): ContentSpec {
  const raw = readFileSync(join(CONTENT_DIR, 'content-spec.json'), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse content-spec.json: ${(error as Error).message}`);
  }
  return parseContentSpec(parsed);
}

/** Read the serialized theme.css (CSS custom properties) for inline injection. */
export function loadThemeCss(): string {
  return readFileSync(join(CONTENT_DIR, 'theme.css'), 'utf8');
}
