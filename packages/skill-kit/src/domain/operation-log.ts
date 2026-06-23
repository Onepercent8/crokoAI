/**
 * operation_logs row builder (create-traffic-campaign §Persistência, §Segurança).
 *
 * One append-only row per Meta mutation. `operation_logs` is never UPDATE/DELETE.
 * Rows must carry no PII/secrets — only entity refs + a short summary.
 */

import { z } from 'zod';

/** Allowed actions on the Meta hierarchy (DB enum, SPEC-000 §6). */
export const OperationActionSchema = z.enum(['create', 'update', 'delete', 'activate', 'pause']);
export type OperationAction = z.infer<typeof OperationActionSchema>;

/** Entity kinds the traffic skill mutates. */
export const OperationEntitySchema = z.enum(['campaign', 'ad_set', 'creative', 'ad']);
export type OperationEntity = z.infer<typeof OperationEntitySchema>;

export const OperationLogRowSchema = z.object({
  entity_type: OperationEntitySchema,
  entity_id: z.string().min(1),
  action: OperationActionSchema,
  actor: z.string().min(1),
  summary: z.string().min(1),
});
export type OperationLogRow = z.infer<typeof OperationLogRowSchema>;

export interface BuildOperationLogInput {
  entity_type: OperationEntity;
  /** The external Meta id of the entity that was mutated. */
  entity_id: string;
  action: OperationAction;
  /** e.g. "skill:create-traffic". Identifies the actor, never a secret. */
  actor: string;
  /** Short, PII-free human summary. */
  summary: string;
}

/**
 * Build a validated, PII-free operation_logs row for a single Meta mutation.
 * Throws (via Zod) if any required field is missing/empty.
 */
export function buildOperationLog(input: BuildOperationLogInput): OperationLogRow {
  return OperationLogRowSchema.parse(input);
}
