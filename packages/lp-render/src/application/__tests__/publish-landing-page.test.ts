import { describe, it, expect } from 'vitest';
import { publishLandingPage } from '../publish-landing-page.js';
import { parseContentDoc, type ContentDoc } from '../../domain/content-doc.js';
import { InMemoryManifest, InMemoryRepo, MockDeployer } from './mocks.js';
import { allSectionsRawDoc } from '../../react/__tests__/all-sections-fixture.js';

const LP_ID = '11111111-1111-4111-8111-111111111111';

function buildDoc(): ContentDoc {
  return parseContentDoc(allSectionsRawDoc());
}

function deps(repo: InMemoryRepo, deployer: MockDeployer, manifest: InMemoryManifest) {
  return { repo, deployer, manifest, runId: 'run-1', stamp: '20260623T000000Z' };
}

describe('publishLandingPage', () => {
  it('rejects a non-uuid landing_page_id (validation)', async () => {
    const repo = new InMemoryRepo();
    await expect(
      publishLandingPage(
        { landing_page_id: 'not-a-uuid' },
        deps(repo, new MockDeployer(), new InMemoryManifest()),
      ),
    ).rejects.toThrow();
  });

  it('aborts when the landing page is not found', async () => {
    const repo = new InMemoryRepo();
    repo.publishView = null;
    const manifest = new InMemoryManifest();
    await expect(
      publishLandingPage({ landing_page_id: LP_ID }, deps(repo, new MockDeployer(), manifest)),
    ).rejects.toThrow(/not found/);
    expect(manifest.entries[0]?.manifest).toMatchObject({ reason: 'landing_page_not_found' });
  });

  it('serializes, deploys and records a deployed status + url', async () => {
    const repo = new InMemoryRepo();
    repo.publishView = {
      landingPageId: LP_ID,
      clientId: 'client-1',
      subdomain: 'curso-exemplo',
      doc: buildDoc(),
    };
    const deployer = new MockDeployer();
    const manifest = new InMemoryManifest();
    const result = await publishLandingPage(
      { landing_page_id: LP_ID },
      deps(repo, deployer, manifest),
    );

    expect(result.fqdn).toBe('curso-exemplo.example.com');
    expect(result.url).toBe('https://curso-exemplo.example.com');
    // building transition then deployed transition.
    expect(repo.patches[0]).toMatchObject({ status: 'building', draft_status: 'publishing' });
    expect(repo.patches.at(-1)).toMatchObject({ status: 'deployed', ssl_status: 'active' });
    expect(repo.logs[0]).toMatchObject({ action: 'update', client_id: 'client-1' });
  });

  it('marks failed and rethrows on deploy failure', async () => {
    const repo = new InMemoryRepo();
    repo.publishView = {
      landingPageId: LP_ID,
      clientId: 'client-1',
      subdomain: 'curso-exemplo',
      doc: buildDoc(),
    };
    const deployer = new MockDeployer();
    deployer.shouldFail = true;
    await expect(
      publishLandingPage({ landing_page_id: LP_ID }, deps(repo, deployer, new InMemoryManifest())),
    ).rejects.toThrow(/deploy failed/);
    expect(repo.patches.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('reuses an existing cloudflare project on re-publish (idempotency)', async () => {
    const repo = new InMemoryRepo();
    repo.publishView = {
      landingPageId: LP_ID,
      clientId: 'client-1',
      subdomain: 'curso-exemplo',
      doc: buildDoc(),
      cloudflareProjectId: 'cf-existing',
    };
    const deployer = new MockDeployer();
    const result = await publishLandingPage(
      { landing_page_id: LP_ID },
      deps(repo, deployer, new InMemoryManifest()),
    );
    expect(deployer.lastInput?.cloudflareProjectId).toBe('cf-existing');
    expect(result.cloudflareProjectId).toBe('cf-existing');
  });
});
