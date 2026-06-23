'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

/**
 * Login form (client component). Posts to `/api/auth/login`; on success the
 * server sets the HttpOnly session cookie and we navigate to the dashboard.
 * The password never leaves this form except inside the POST body over HTTPS.
 */
export function LoginForm({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string | undefined;
}): ReactNode {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError('Falha no login. Verifique a senha e tente novamente.');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Erro de rede. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="password">
        Senha
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {turnstileSiteKey && (
        <div className="cf-turnstile" data-sitekey={turnstileSiteKey} aria-hidden />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
