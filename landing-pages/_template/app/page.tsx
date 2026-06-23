import type { ReactNode } from 'react';
import { LandingPage } from '@template/lp-render/react';
import { loadContentSpec } from '@/lib/content';

/**
 * The landing page itself (static export). Reads the validated content-spec and
 * renders the 17-section catalog via the shared @template/lp-render React layer.
 * Pure render from build-time data — no client JS required for the content.
 */
export default function Page(): ReactNode {
  const spec = loadContentSpec();
  return <LandingPage spec={spec} />;
}
