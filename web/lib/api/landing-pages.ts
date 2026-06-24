import {
  SECTION_FIELD_SCHEMAS,
  SECTION_TYPES,
  SectionTypeSchema,
  type SectionType,
} from '@template/lp-render';
import { z } from 'zod';

/**
 * Application layer for the dashboard landing-page editor (SPEC-012, Onda 9).
 *
 * The 17 per-section field schemas are the SINGLE SOURCE OF TRUTH in
 * `@template/lp-render` (`SECTION_FIELD_SCHEMAS`). We do NOT redefine them here:
 * the editor validates against exactly the schema the renderer/serializer use, so
 * an edit can never produce content the build would reject (ADR 0017).
 *
 * Draft edits are SYNCHRONOUS (request/response → UPDATE `landing_page_sections`);
 * publishing remains a heavy queued job (`landing_publish`/`landing_edit`,
 * ADR 0009) and is only ENQUEUED here, never executed.
 *
 * Pure module: no I/O. `reconcile`/`setByPath`/`getByPath` are deterministic and
 * unit-tested; the Hono route wires them to the `service_role` repository.
 */

// --- edit-path ---------------------------------------------------------------

/** Keys that would enable prototype pollution; never allowed in an edit path. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Max nesting depth a dotted path may address (defense against deep payloads). */
export const MAX_PATH_DEPTH = 8;

/**
 * Dotted path into a section's `fields`. Charset-restricted to `[a-zA-Z0-9_]`
 * segments joined by `.` so it can never carry a proto-pollution key, a bracket
 * index escape, or whitespace. Array indices use numeric segments
 * (e.g. `items.0.title`).
 */
export const EditPathSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/, 'invalid edit path');

/** Split + validate a path into safe segments (throws on forbidden/over-deep). */
export function parsePath(path: string): string[] {
  const segments = EditPathSchema.parse(path).split('.');
  if (segments.length > MAX_PATH_DEPTH) {
    throw new Error(`edit path too deep (max ${MAX_PATH_DEPTH})`);
  }
  for (const seg of segments) {
    if (FORBIDDEN_KEYS.has(seg)) {
      throw new Error(`forbidden path segment: ${seg}`);
    }
  }
  return segments;
}

/** A path segment is an array index when it is a non-negative integer string. */
function isIndex(segment: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(segment);
}

/**
 * Read the value addressed by `path` from `obj`, or `undefined` if any segment
 * is missing. Never throws on a missing intermediate (returns `undefined`).
 */
export function getByPath(obj: unknown, path: string): unknown {
  const segments = parsePath(path);
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/**
 * Return a deep clone of `obj` with `path` set to `value`. Intermediate
 * containers are created when absent: a numeric next-segment creates an array,
 * otherwise an object. Pure (does not mutate `obj`). Throws on a forbidden or
 * over-deep path.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = parsePath(path);
  const root = structuredClone(obj);
  let cursor: Record<string, unknown> | unknown[] = root;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] as string;
    const last = i === segments.length - 1;

    if (last) {
      if (Array.isArray(cursor)) {
        cursor[Number(seg)] = value;
      } else {
        cursor[seg] = value;
      }
      break;
    }

    const nextSeg = segments[i + 1] as string;
    const container = Array.isArray(cursor)
      ? cursor[Number(seg)]
      : (cursor as Record<string, unknown>)[seg];

    let nextContainer: Record<string, unknown> | unknown[];
    if (container !== null && typeof container === 'object') {
      nextContainer = container as Record<string, unknown> | unknown[];
    } else {
      nextContainer = isIndex(nextSeg) ? [] : {};
      if (Array.isArray(cursor)) {
        cursor[Number(seg)] = nextContainer;
      } else {
        (cursor as Record<string, unknown>)[seg] = nextContainer;
      }
    }
    cursor = nextContainer;
  }

  return root;
}

// --- Edit request ------------------------------------------------------------

/**
 * One edit targets a single section and a single field path. `value` is
 * `unknown` until the whole section is re-validated during `reconcile`.
 * `expectedVersion` powers optimistic concurrency against
 * `landing_page_sections.version`.
 */
export const EditRequestSchema = z.object({
  sectionType: SectionTypeSchema,
  path: EditPathSchema,
  value: z.unknown(),
  expectedVersion: z.number().int().nonnegative(),
});
export type EditRequest = z.infer<typeof EditRequestSchema>;

/** A whole-section replacement (used when editing a complex section at once). */
export const SectionReplaceSchema = z.object({
  sectionType: SectionTypeSchema,
  fields: z.unknown(),
  expectedVersion: z.number().int().nonnegative(),
});
export type SectionReplace = z.infer<typeof SectionReplaceSchema>;

// --- reconcile ---------------------------------------------------------------

export type ReconcileResult =
  | { ok: true; next: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] };

function unknownTypeIssue(): z.ZodIssue[] {
  return [
    {
      code: z.ZodIssueCode.custom,
      path: ['sectionType'],
      message: 'unknown section type',
    },
  ];
}

/** Look up the per-type schema; `null` for an unknown type (deny-by-default). */
export function schemaFor(type: string): (typeof SECTION_FIELD_SCHEMAS)[SectionType] | null {
  if (!(SECTION_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  return SECTION_FIELD_SCHEMAS[type as SectionType];
}

/**
 * Apply a single-field patch onto a copy of the current `fields`, then validate
 * the ENTIRE resulting section against its schema. Only a section that is valid
 * as a whole is accepted — a patch can never persist a half-valid object.
 */
export function reconcile(current: Record<string, unknown>, edit: EditRequest): ReconcileResult {
  const schema = schemaFor(edit.sectionType);
  if (schema === null) {
    return { ok: false, issues: unknownTypeIssue() };
  }
  let candidate: Record<string, unknown>;
  try {
    candidate = setByPath(current, edit.path, edit.value);
  } catch (error) {
    return {
      ok: false,
      issues: [{ code: z.ZodIssueCode.custom, path: ['path'], message: (error as Error).message }],
    };
  }
  const parsed = schema.safeParse(candidate);
  return parsed.success
    ? { ok: true, next: parsed.data as Record<string, unknown> }
    : { ok: false, issues: parsed.error.issues };
}

/** Validate a full-section replacement against its schema (whole-object). */
export function reconcileReplace(edit: SectionReplace): ReconcileResult {
  const schema = schemaFor(edit.sectionType);
  if (schema === null) {
    return { ok: false, issues: unknownTypeIssue() };
  }
  const parsed = schema.safeParse(edit.fields);
  return parsed.success
    ? { ok: true, next: parsed.data as Record<string, unknown> }
    : { ok: false, issues: parsed.error.issues };
}

// --- Optimistic concurrency --------------------------------------------------

export type VersionCheck = { ok: true } | { ok: false; reason: 'conflict' };

/** Compare the client's expected version with the persisted one. */
export function checkVersion(expected: number, actual: number): VersionCheck {
  return expected === actual ? { ok: true } : { ok: false, reason: 'conflict' };
}

// --- Repository port (I/O behind an interface; real impl uses service_role) ---

export interface SectionRow {
  fields: Record<string, unknown>;
  version: number;
  enabled: boolean;
  position: number;
}

export interface UpdatedSection {
  type: SectionType;
  fields: Record<string, unknown>;
  version: number;
}

/** Result of an edit attempt at the application boundary. */
export type EditOutcome =
  | { status: 'updated'; section: UpdatedSection }
  | { status: 'conflict' }
  | { status: 'invalid'; issues: z.ZodIssue[] }
  | { status: 'not_found' }
  | { status: 'locked' };

/**
 * Persistence port for the editor. The browser NEVER touches these tables; the
 * real implementation uses Supabase REST + `service_role` (RLS deny-by-default).
 * Tests inject an in-memory fake (no network).
 */
export interface LandingEditorRepository {
  /** Read the draft_status of the page (to block edits while publishing). */
  getDraftStatus(landingPageId: string): Promise<string | null>;
  /** Read one section by (page,type), or `null` if absent. */
  getSection(landingPageId: string, type: SectionType): Promise<SectionRow | null>;
  /**
   * Persist the new fields with optimistic concurrency: update only when the
   * stored version still equals `expectedVersion`, bumping it by one and setting
   * `landing_pages.draft_status='editing'`. Returns the new version, or `null`
   * when the version no longer matches (lost-update guard).
   */
  applyEdit(input: {
    landingPageId: string;
    type: SectionType;
    fields: Record<string, unknown>;
    expectedVersion: number;
  }): Promise<{ version: number } | null>;
}

/** Draft statuses during which editing is blocked (a publish is in flight). */
const LOCKED_STATUSES = new Set(['publishing']);

/**
 * Apply one field edit end-to-end (application service):
 * version check → reconcile (whole-section validation) → optimistic UPDATE.
 * Order matters: the LP must not be `publishing`, the version must match, and
 * the section must validate before any write.
 */
export async function applyFieldEdit(
  repo: LandingEditorRepository,
  landingPageId: string,
  edit: EditRequest,
): Promise<EditOutcome> {
  const draftStatus = await repo.getDraftStatus(landingPageId);
  if (draftStatus === null) {
    return { status: 'not_found' };
  }
  if (LOCKED_STATUSES.has(draftStatus)) {
    return { status: 'locked' };
  }

  const section = await repo.getSection(landingPageId, edit.sectionType);
  if (section === null) {
    return { status: 'not_found' };
  }

  const version = checkVersion(edit.expectedVersion, section.version);
  if (!version.ok) {
    return { status: 'conflict' };
  }

  const result = reconcile(section.fields, edit);
  if (!result.ok) {
    return { status: 'invalid', issues: result.issues };
  }

  const applied = await repo.applyEdit({
    landingPageId,
    type: edit.sectionType,
    fields: result.next,
    expectedVersion: edit.expectedVersion,
  });
  if (applied === null) {
    // Raced with a concurrent edit between read and write.
    return { status: 'conflict' };
  }

  return {
    status: 'updated',
    section: { type: edit.sectionType, fields: result.next, version: applied.version },
  };
}

/** Map an {@link EditOutcome} to an HTTP status code (used by the route). */
export function editOutcomeStatus(outcome: EditOutcome): 200 | 404 | 409 | 422 | 423 {
  switch (outcome.status) {
    case 'updated':
      return 200;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'invalid':
      return 422;
    case 'locked':
      return 423;
  }
}

// --- Publish enqueue (heavy job, NOT executed here) --------------------------

/** `agent_jobs.kind` values the editor may enqueue (publish/edit are heavy). */
export const PublishKindSchema = z.enum(['landing_publish', 'landing_edit']);
export type PublishKind = z.infer<typeof PublishKindSchema>;
