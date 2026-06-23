import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { formatCents } from '@/lib/format';
import { safeRead } from '@/lib/safe-read';
import { listCampaigns } from '@/lib/services/campaigns';
import { getClientBySlug } from '@/lib/services/clients';
import type { CampaignRow } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/** Client detail + its campaigns (server-side reads). */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ReactNode> {
  const { slug } = await params;
  const { data: client } = await safeRead('client.getBySlug', () => getClientBySlug(slug), null);

  if (client === null) {
    notFound();
  }

  const { data: campaigns } = await safeRead<CampaignRow[]>(
    'client.listCampaigns',
    () => listCampaigns(client.id),
    [],
  );

  return (
    <Shell title={client.name}>
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-zinc-500">Slug</dt>
          <dd className="text-right font-mono">{client.slug}</dd>
          <dt className="text-zinc-500">Ad account</dt>
          <dd className="text-right font-mono">{client.ad_account_id}</dd>
          <dt className="text-zinc-500">Teto diário</dt>
          <dd className="text-right">
            {formatCents(client.daily_budget_cap_cents, client.currency)}
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Campanhas</h2>
        {campaigns.length === 0 ? (
          <EmptyState message="Nenhuma campanha para este cliente." />
        ) : (
          <ul className="flex flex-col gap-2">
            {campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <span>{campaign.name ?? '(sem nome)'}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs dark:bg-zinc-800">
                  {campaign.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
