import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { safeRead } from '@/lib/safe-read';
import { listClients } from '@/lib/services/clients';
import { listAgentEvents, listOperationLogs } from '@/lib/services/logs';
import type { AgentEventRow, OperationLogRow } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/**
 * Audit view: operation_logs (per client) + agent_events. Both are append-only
 * and NO-PII; read-only here. Server-side reads via `service_role`.
 */
export default async function LogsPage(): Promise<ReactNode> {
  const { data: clients } = await safeRead('logs.listClients', listClients, []);
  const first = clients[0];
  const { data: operations } = await safeRead<OperationLogRow[]>(
    'logs.operations',
    () => (first ? listOperationLogs(first.id) : Promise.resolve([])),
    [],
  );
  const { data: events } = await safeRead<AgentEventRow[]>(
    'logs.events',
    () => listAgentEvents(),
    [],
  );

  return (
    <Shell title="Logs">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Operações</h2>
        {operations.length === 0 ? (
          <EmptyState message="Nenhuma operação registrada." />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {operations.map((log) => (
              <li
                key={log.id}
                className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900"
              >
                <span className="font-mono text-xs">
                  {log.action} · {log.entity_type}
                </span>
                <span className="text-zinc-500">{log.summary ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Eventos de agente</h2>
        {events.length === 0 ? (
          <EmptyState message="Nenhum evento de agente." />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900"
              >
                <span className="font-mono text-xs">
                  {event.agent_name ?? '?'} · {event.event_type ?? '?'}
                </span>
                <span className="text-zinc-500">{event.tool_name ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
