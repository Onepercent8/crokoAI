import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';
import type { AnalysisFindingRow, AnalysisRow } from './types';

/** Read service for analyses and their findings (SPEC-000 §6). */

const ANALYSIS_COLUMNS =
  'id, client_id, objective, window_start, window_stop, overall_verdict, summary, entities_analyzed, created_at';

const FINDING_COLUMNS =
  'id, analysis_id, severity, diagnosis, recommended_action, is_significant, created_at';

const uuidSchema = z.string().uuid();

/** List analyses for a client (most recent first). */
export async function listAnalyses(clientId: string): Promise<AnalysisRow[]> {
  const parsed = uuidSchema.parse(clientId);
  const { data, error } = await getDb()
    .from('analyses')
    .select(ANALYSIS_COLUMNS)
    .eq('client_id', parsed)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list analyses: ${error.message}`);
  }
  return (data ?? []) as AnalysisRow[];
}

/** List findings for a given analysis (significant first, then severity order). */
export async function listAnalysisFindings(analysisId: string): Promise<AnalysisFindingRow[]> {
  const parsed = uuidSchema.parse(analysisId);
  const { data, error } = await getDb()
    .from('analysis_findings')
    .select(FINDING_COLUMNS)
    .eq('analysis_id', parsed)
    .order('is_significant', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list analysis findings: ${error.message}`);
  }
  return (data ?? []) as AnalysisFindingRow[];
}
