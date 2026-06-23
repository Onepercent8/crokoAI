import { describe, it, expect } from 'vitest';
import { createLandingPage } from '../create-landing-page.js';
import { InMemoryManifest, InMemoryRepo } from './mocks.js';
import { allSectionsRawDoc } from '../../react/__tests__/all-sections-fixture.js';
import type { ProductRecord } from '../ports.js';

function deps(repo: InMemoryRepo, manifest: InMemoryManifest, buildDoc: () => unknown) {
  return {
    repo,
    manifest,
    buildContentDoc: async (_p: ProductRecord) => buildDoc(),
    runId: 'run-1',
    stamp: '20260623T000000Z',
  };
}

const product: ProductRecord = {
  id: 'prod-1',
  client_id: 'client-1',
  slug: 'curso-exemplo',
};

describe('createLandingPage', () => {
  it('rejects args with invalid slug charset (input is data)', async () => {
    const repo = new InMemoryRepo();
    await expect(
      createLandingPage(
        { client_slug: 'Cliente Exemplo', product_slug: 'curso-exemplo' },
        deps(repo, new InMemoryManifest(), allSectionsRawDoc),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown client slug (allowlist server-side)', async () => {
    const repo = new InMemoryRepo();
    repo.product = product;
    await expect(
      createLandingPage(
        { client_slug: 'unknown-client', product_slug: 'curso-exemplo' },
        deps(repo, new InMemoryManifest(), allSectionsRawDoc),
      ),
    ).rejects.toThrow(/unknown client slug/);
  });

  it('aborts (no writes) when the product is not found', async () => {
    const repo = new InMemoryRepo();
    repo.product = null;
    const manifest = new InMemoryManifest();
    await expect(
      createLandingPage(
        { client_slug: 'cliente-exemplo', product_slug: 'missing' },
        deps(repo, manifest, allSectionsRawDoc),
      ),
    ).rejects.toThrow(/not found/);
    expect(repo.landingPages).toHaveLength(0);
    expect(repo.jobs).toHaveLength(0);
    expect(manifest.entries[0]?.manifest).toMatchObject({ reason: 'product_not_found' });
  });

  it('rejects an invalid generated ContentDoc (untrusted IA output)', async () => {
    const repo = new InMemoryRepo();
    repo.product = product;
    const manifest = new InMemoryManifest();
    await expect(
      createLandingPage(
        { client_slug: 'cliente-exemplo', product_slug: 'curso-exemplo' },
        deps(repo, manifest, () => ({ settings: {}, theme: {}, sections: [] })),
      ),
    ).rejects.toThrow(/failed validation/);
    expect(repo.landingPages).toHaveLength(0);
  });

  it('persists draft (noindex), one row per section, and enqueues publish', async () => {
    const repo = new InMemoryRepo();
    repo.product = product;
    const manifest = new InMemoryManifest();
    const result = await createLandingPage(
      { client_slug: 'cliente-exemplo', product_slug: 'curso-exemplo' },
      deps(repo, manifest, allSectionsRawDoc),
    );

    expect(result.sectionCount).toBe(17);
    expect(result.publishEnqueued).toBe(true);

    const lp = repo.landingPages[0];
    expect(lp?.noindex).toBe(true);
    expect(lp?.status).toBe('draft');
    expect(lp?.draft_status).toBe('ready');
    expect(lp?.price_cents).toBe(19700); // integer cents

    expect(repo.sections).toHaveLength(17);
    expect(repo.jobs[0]).toMatchObject({
      kind: 'landing_publish',
      skill: 'publish-landing-page-cliente-exemplo',
      status: 'pending',
    });
    expect(repo.logs[0]).toMatchObject({ action: 'create', entity_type: 'landing_page' });
  });

  it('treats a duplicate active publish job as already queued (not fatal)', async () => {
    const repo = new InMemoryRepo();
    repo.product = product;
    repo.rejectNextEnqueue = true;
    const result = await createLandingPage(
      { client_slug: 'cliente-exemplo', product_slug: 'curso-exemplo' },
      deps(repo, new InMemoryManifest(), allSectionsRawDoc),
    );
    expect(result.publishEnqueued).toBe(false);
    // The draft + sections are still persisted.
    expect(repo.landingPages).toHaveLength(1);
    expect(repo.sections).toHaveLength(17);
  });

  it('uses an explicit subdomain when provided', async () => {
    const repo = new InMemoryRepo();
    repo.product = product;
    await createLandingPage(
      { client_slug: 'cliente-exemplo', product_slug: 'curso-exemplo', subdomain: 'promo-junho' },
      deps(repo, new InMemoryManifest(), allSectionsRawDoc),
    );
    expect(repo.landingPages[0]?.subdomain).toBe('promo-junho');
  });
});
