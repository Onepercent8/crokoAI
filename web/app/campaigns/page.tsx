import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { formatCents } from '@/lib/format';
import { safeRead } from '@/lib/safe-read';
import { listCampaigns } from '@/lib/services/campaigns';
import { listClients } from '@/lib/services/clients';
import type { CampaignRow } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/**
 * Meta campaign hierarchy. Defaults to the first client; a full implementation
 * adds a client selector. Reads are server-side via `service_role`.
 */
export default async function CampaignsPage(): Promise<ReactNode> {
  const { data: clients } = await safeRead('campaigns.listClients', listClients, []);
  const first = clients[0];
  const { data: campaigns } = await safeRead<CampaignRow[]>(
    'campaigns.list',
    () => (first ? listCampaigns(first.id) : Promise.resolve([])),
    [],
  );

  return (
    <Shell title="Campanhas">
      {campaigns.length === 0 ? (
        <EmptyState message="Nenhuma campanha encontrada." />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2">Nome</th>
              <th className="py-2">Objetivo</th>
              <th className="py-2">Orçamento</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2">{campaign.name ?? '(sem nome)'}</td>
                <td className="py-2 font-mono text-xs">{campaign.objective}</td>
                <td className="py-2">
                  {formatCents(campaign.daily_budget_cents, first?.currency ?? 'BRL')}
                </td>
                <td className="py-2 font-mono text-xs">{campaign.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}
