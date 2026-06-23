/**
 * Row types for the dashboard read services (subset of SPEC-000 §6 schema).
 *
 * These mirror the columns the dashboard reads. Money columns are integer cents;
 * Meta external IDs are `string` (text in Postgres). Keep these in sync with the
 * Supabase migrations under `supabase/migrations/`.
 */

export interface ClientRow {
  id: string;
  slug: string;
  name: string;
  ad_account_id: string;
  default_landing_url: string | null;
  daily_budget_cap_cents: number;
  currency: string;
  created_at: string;
}

export interface CampaignRow {
  id: string;
  client_id: string;
  meta_campaign_id: string | null;
  name: string | null;
  objective: string;
  budget_mode: 'CBO' | 'ABO' | null;
  daily_budget_cents: number | null;
  status: string;
  created_at: string;
}

export interface AnalysisRow {
  id: string;
  client_id: string;
  objective: string | null;
  window_start: string | null;
  window_stop: string | null;
  overall_verdict: string | null;
  summary: string | null;
  entities_analyzed: number;
  created_at: string;
}

export interface AnalysisFindingRow {
  id: string;
  analysis_id: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | null;
  diagnosis: string | null;
  recommended_action: string | null;
  is_significant: boolean;
  created_at: string;
}

export interface FunnelEventRow {
  id: string;
  analysis_id: string;
  level: 'account' | 'campaign' | 'ad_set' | 'ad';
  meta_entity_id: string | null;
  step_order: number;
  event_type: string;
  count: number | null;
  value_cents: number | null;
  cost_per_event_cents: number | null;
  cvr_from_prev: number | null;
  cvr_from_top: number | null;
}

export interface OperationLogRow {
  id: string;
  client_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: 'create' | 'update' | 'delete' | 'activate' | 'pause';
  actor: string | null;
  summary: string | null;
  created_at: string;
}

export interface AgentEventRow {
  id: string;
  run_id: string | null;
  agent_name: string | null;
  agent_type: 'skill' | 'subagent' | 'tool' | 'system' | null;
  event_type: 'start' | 'step' | 'decision' | 'error' | 'end' | null;
  tool_name: string | null;
  created_at: string;
}
