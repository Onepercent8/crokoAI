/**
 * Manifest file writer (infrastructure side of domain/manifest.ts).
 *
 * Keeps the fs touch out of the pure domain. The path + serialization come from
 * the domain; this module only performs the I/O. The reader supports the
 * idempotency check (find a prior `completed` manifest for the same key).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MANIFEST_DIR,
  ManifestSchema,
  manifestFileName,
  serializeManifest,
  type Manifest,
  type ManifestKind,
} from '../domain/manifest.js';

/**
 * Write a manifest under `<baseDir>/tentativas-geracao-de-campanhas/`.
 * Returns the absolute path written. Validates + serializes via the domain.
 */
export async function writeManifest(
  baseDir: string,
  manifest: Manifest,
  stampIso: string,
): Promise<string> {
  const dir = join(baseDir, MANIFEST_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, manifestFileName(stampIso, manifest.kind as ManifestKind));
  await writeFile(filePath, serializeManifest(manifest), 'utf8');
  return filePath;
}

/**
 * Find the most recent prior manifest with a matching idempotency key and
 * `status === 'completed'`. Returns it or null. Used to avoid recreating a
 * campaign on a re-run (create-traffic-campaign §Idempotência).
 */
export async function findCompletedManifest(
  baseDir: string,
  idempotencyKey: string,
): Promise<Manifest | null> {
  const dir = join(baseDir, MANIFEST_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // No attempts directory yet -> nothing to dedup against.
    return null;
  }
  const jsonNames = names.filter((n) => n.endsWith('.json')).sort();
  // Newest last (names are sorted by ISO stamp prefix); scan from the end.
  for (let i = jsonNames.length - 1; i >= 0; i -= 1) {
    const name = jsonNames[i];
    if (name === undefined) {
      continue;
    }
    const raw = await readFile(join(dir, name), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = ManifestSchema.safeParse(parsed);
    if (!result.success) {
      continue;
    }
    if (result.data.idempotency_key === idempotencyKey && result.data.status === 'completed') {
      return result.data;
    }
  }
  return null;
}
