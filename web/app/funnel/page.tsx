import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { formatCents, formatCount } from '@/lib/format';
import { safeRead } from '@/lib/safe-read';
import { listAnalyses } from '@/lib/services/analyses';
import { listClients } from '@/lib/services/clients';
import { listFunnelEvents } from '@/lib/services/funnel';
import type { FunnelEventRow } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/**
 * Conversion funnel (7 steps) for the latest analysis of the first client.
 * Server-side reads via `service_role`.
 */
export default async function FunnelPage(): Promise<ReactNode> {
  const { data: clients } = await safeRead('funnel.listClients', listClients, []);
  const first = clients[0];
  const { data: analyses } = await safeRead(
    'funnel.listAnalyses',
    () => (first ? listAnalyses(first.id) : Promise.resolve([])),
    [],
  );
  const latest = analyses[0];
  const { data: events } = await safeRead<FunnelEventRow[]>(
    'funnel.listEvents',
    () => (latest ? listFunnelEvents(latest.id) : Promise.resolve([])),
    [],
  );

  return (
    <Shell title="Funil de conversão">
      {events.length === 0 ? (
        <EmptyState message="Nenhum evento de funil disponível." />
      ) : (
        <ol className="flex flex-col gap-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <span className="font-mono text-xs text-zinc-500">
                #{event.step_order} {event.event_type}
              </span>
              <span className="flex gap-4">
                <span>{formatCount(event.count)}</span>
                <span className="text-zinc-500">
                  {formatCents(event.value_cents, first?.currency ?? 'BRL')}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}
