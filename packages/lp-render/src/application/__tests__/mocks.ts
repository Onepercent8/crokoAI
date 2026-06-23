import type {
  DeployResult,
  LandingDeployer,
  LandingPageDraft,
  LandingPageSectionRow,
  LandingPublishView,
  LandingRepository,
  ManifestSink,
  OperationLogEntry,
  ProductRecord,
  PublishJobRow,
} from '../ports.js';
import type { ContentDoc } from '../../domain/content-doc.js';

/** In-memory LandingRepository mock for offline application tests. */
export class InMemoryRepo implements LandingRepository {
  product: ProductRecord | null = null;
  landingPages: LandingPageDraft[] = [];
  sections: LandingPageSectionRow[] = [];
  jobs: PublishJobRow[] = [];
  logs: OperationLogEntry[] = [];
  publishView: LandingPublishView | null = null;
  patches: Array<Record<string, unknown>> = [];
  /** When true, the next enqueue is rejected as a duplicate (DB unique index). */
  rejectNextEnqueue = false;

  async findProduct(): Promise<ProductRecord | null> {
    return this.product;
  }

  async insertLandingPage(draft: LandingPageDraft): Promise<{ id: string }> {
    this.landingPages.push(draft);
    return { id: draft.id };
  }

  async insertSections(rows: LandingPageSectionRow[]): Promise<void> {
    this.sections.push(...rows);
  }

  async enqueuePublishJob(job: PublishJobRow): Promise<{ enqueued: boolean }> {
    if (this.rejectNextEnqueue) {
      this.rejectNextEnqueue = false;
      return { enqueued: false };
    }
    this.jobs.push(job);
    return { enqueued: true };
  }

  async appendOperationLog(entry: OperationLogEntry): Promise<void> {
    this.logs.push(entry);
  }

  async loadForPublish(): Promise<LandingPublishView | null> {
    return this.publishView;
  }

  async updateLandingPagePublish(_id: string, patch: Record<string, unknown>): Promise<void> {
    this.patches.push(patch);
  }
}

/** Records manifest writes in memory. */
export class InMemoryManifest implements ManifestSink {
  entries: Array<{ name: string; manifest: unknown }> = [];
  async write(name: string, manifest: unknown): Promise<void> {
    this.entries.push({ name, manifest });
  }
}

/** Deployer mock; can be configured to fail. */
export class MockDeployer implements LandingDeployer {
  shouldFail = false;
  lastInput: { subdomain: string; cloudflareProjectId?: string } | null = null;

  async deploy(input: {
    landingPageId: string;
    subdomain: string;
    doc: ContentDoc;
    cloudflareProjectId?: string;
  }): Promise<DeployResult> {
    this.lastInput = {
      subdomain: input.subdomain,
      ...(input.cloudflareProjectId !== undefined
        ? { cloudflareProjectId: input.cloudflareProjectId }
        : {}),
    };
    if (this.shouldFail) {
      throw new Error('mock deploy failure');
    }
    const projectId = input.cloudflareProjectId ?? `cf-${input.landingPageId}`;
    return {
      url: `https://${input.subdomain}.example.com`,
      fqdn: `${input.subdomain}.example.com`,
      cloudflareProjectId: projectId,
    };
  }
}
