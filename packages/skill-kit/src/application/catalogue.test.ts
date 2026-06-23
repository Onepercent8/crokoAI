import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductBriefSchema } from '../domain/schemas.js';

// Resolve the repo root relative to this test file (packages/skill-kit/src/application).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const materialsDir = resolve(repoRoot, '.claude/materiais-das-empresas');

describe('catalogue files (cliente-exemplo)', () => {
  it('the curso-exemplo brief validates against ProductBriefSchema', async () => {
    const path = resolve(materialsDir, 'cliente-exemplo/produtos/curso-exemplo.json');
    const raw = JSON.parse(await readFile(path, 'utf8'));
    const parsed = ProductBriefSchema.parse(raw);
    expect(parsed.client_slug).toBe('cliente-exemplo');
    expect(parsed.objective).toBe('OUTCOME_TRAFFIC');
    expect(Number.isInteger(parsed.price_cents)).toBe(true);
  });

  it('lista-de-clientes lists cliente-exemplo', async () => {
    const raw = JSON.parse(await readFile(resolve(materialsDir, 'lista-de-clientes.json'), 'utf8'));
    const slugs = raw.clients.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('cliente-exemplo');
  });

  it('lista-de-produtos references the curso-exemplo brief', async () => {
    const raw = JSON.parse(await readFile(resolve(materialsDir, 'lista-de-produtos.json'), 'utf8'));
    const slugs = raw.products.map((p: { product_slug: string }) => p.product_slug);
    expect(slugs).toContain('curso-exemplo');
  });
});
