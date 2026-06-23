import type { ReactNode } from 'react';

import { EmptyState, Shell } from '@/components/shell';
import { safeRead } from '@/lib/safe-read';
import { listAnalyses } from '@/lib/services/analyses';
import { listClients } from '@/lib/services/clients';
import type { AnalysisRow } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/** Analyses list for the first client (server-side reads). */
export default async function AnalysesPage(): Promise<ReactNode> {
  const { data: clients } = await safeRead('analyses.listClients', listClients, []);
  const first = clients[0];
  const { data: analyses } = await safeRead<AnalysisRow[]>(
    'analyses.list',
    () => (first ? listAnalyses(first.id) : Promise.resolve([])),
    [],
  );

  return (
    <Shell title="Análises">
      {analyses.length === 0 ? (
        <EmptyState message="Nenhuma análise registrada." />
      ) : (
        <ul className="flex flex-col gap-3">
          {analyses.map((analysis) => (
            <li
              key={analysis.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{analysis.objective ?? 'Análise'}</span>
                {analysis.overall_verdict && (
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                    {analysis.overall_verdict}
                  </span>
                )}
              </div>
              {analysis.summary && <p className="mt-2 text-sm text-zinc-500">{analysis.summary}</p>}
              <p className="mt-2 text-xs text-zinc-400">
                {analysis.entities_analyzed} entidades · {analysis.created_at}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
