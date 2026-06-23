import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { formatCents } from '@/lib/format';
import { safeRead } from '@/lib/safe-read';
import { listClients } from '@/lib/services/clients';
import type { ClientRow } from '@/lib/services/types';

/** Reads run on the server on each request (RLS-closed to the browser). */
export const dynamic = 'force-dynamic';

/** Overview page: lists clients read server-side via `service_role`. */
export default async function OverviewPage(): Promise<ReactNode> {
  const { data: clients, ok } = await safeRead<ClientRow[]>(
    'overview.listClients',
    listClients,
    [],
  );

  return (
    <Shell title="Visão geral">
      {!ok && (
        <EmptyState message="Não foi possível ler o banco. Verifique as credenciais do servidor." />
      )}
      {ok && clients.length === 0 && (
        <EmptyState message="Nenhum cliente ainda. O seed registra cliente-exemplo." />
      )}
      {clients.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <li
              key={client.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <Link
                href={`/clients/${client.slug}`}
                className="text-lg font-medium hover:underline"
              >
                {client.name}
              </Link>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm text-zinc-500">
                <dt>Ad account</dt>
                <dd className="text-right font-mono">{client.ad_account_id}</dd>
                <dt>Teto diário</dt>
                <dd className="text-right">
                  {formatCents(client.daily_budget_cap_cents, client.currency)}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
