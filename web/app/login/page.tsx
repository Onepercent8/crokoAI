import type { ReactNode } from 'react';

import { getPublicEnv } from '@/lib/env';

import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/**
 * Login page (public). Reads only the browser-safe public env to decide whether
 * to render the Turnstile widget. The secret key never reaches this component.
 */
export default function LoginPage(): ReactNode {
  let turnstileSiteKey: string | undefined;
  try {
    turnstileSiteKey = getPublicEnv().NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  } catch {
    // In an unconfigured scaffold, just render the form without Turnstile.
    turnstileSiteKey = undefined;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">Acme — Operations</h1>
        <p className="mt-1 text-sm text-zinc-500">Acesso restrito ao operador.</p>
        <LoginForm turnstileSiteKey={turnstileSiteKey} />
      </div>
    </div>
  );
}
