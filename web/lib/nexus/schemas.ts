import { z } from 'zod';

/**
 * Zod schemas for the Nexus voice-chat surface (SPEC-016).
 *
 * Every HTTP boundary validates with these BEFORE any logic runs
 * (`.claude/rules/security.md`). All free-form arguments use a restricted
 * charset (anti prompt-injection): transcribed speech, screen text and scraped
 * content are treated as DATA, never as instruction.
 */

/** Restricted slug charset (client/product/skill identifiers). */
export const Slug = z.string().regex(/^[a-z0-9-]{1,64}$/, 'invalid slug');

/** Session identifier (UUID). */
export const SessionId = z.string().uuid();

/** A single chat turn / transcription. Bounded length to cap cost + abuse. */
export const SafeText = z.string().min(1).max(4000);

/** Closed set of write-action slugs the model may reference (allowlist keys). */
export const SkillSlugEnum = z.enum([
  'create',
  'sales',
  'activate',
  'analyze',
  'landing',
  'publish',
]);
export type SkillSlug = z.infer<typeof SkillSlugEnum>;

/** Closed set of `agent_jobs.kind` values reachable from Nexus. */
export const KindEnum = z.enum([
  'create',
  'create_sales',
  'activate',
  'analyze',
  'landing',
  'landing_publish',
]);
export type Kind = z.infer<typeof KindEnum>;

// --- POST /api/nexus/chat ---------------------------------------------------

export const ChatRequest = z.object({
  session_id: SessionId,
  message: SafeText,
  screen_context_id: z.string().uuid().optional(),
});
export type ChatRequestT = z.infer<typeof ChatRequest>;

export const PendingActionSchema = z.object({
  action_id: z.string().uuid(),
  slug: SkillSlugEnum,
  kind: KindEnum,
  client_id: z.string().uuid(),
  args_preview: z.record(z.unknown()),
  expires_at: z.string().datetime(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const ChatResponse = z.object({
  session_id: SessionId,
  reply: z.string(),
  pending_action: PendingActionSchema.nullable(),
  tool_reads: z.array(z.object({ tool: z.string(), ok: z.boolean() })).default([]),
});
export type ChatResponseT = z.infer<typeof ChatResponse>;

// --- POST /api/nexus/confirm ------------------------------------------------

export const ConfirmRequest = z.object({
  session_id: SessionId,
  action_id: z.string().uuid(),
});
export type ConfirmRequestT = z.infer<typeof ConfirmRequest>;

export const ConfirmStatusEnum = z.enum(['queued', 'already_queued', 'expired', 'rejected']);
export type ConfirmStatus = z.infer<typeof ConfirmStatusEnum>;

export const ConfirmResponse = z.object({
  enqueued: z.boolean(),
  agent_job_id: z.string().uuid().nullable(),
  status: ConfirmStatusEnum,
});
export type ConfirmResponseT = z.infer<typeof ConfirmResponse>;

// --- STT / TTS / capture / narrations ---------------------------------------

export const SttResponse = z.object({
  text: z.string(),
  duration_ms: z.number().int().nonnegative(),
});

export const TtsRequest = z.object({
  text: SafeText,
  voice_id: z.string().max(128).optional(),
});
export type TtsRequestT = z.infer<typeof TtsRequest>;

export const CaptureRequest = z.object({
  session_id: SessionId,
  // data URL (png/jpeg, base64). Bounded to cap memory; it is ephemeral data.
  image: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, 'invalid image data URL'),
});
export type CaptureRequestT = z.infer<typeof CaptureRequest>;

export const CaptureResponse = z.object({ screen_context_id: z.string().uuid() });

export const NarrationsQuery = z.object({ session_id: SessionId });

export const NarrationsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      text: z.string(),
      kind: z.enum(['status', 'opinion', 'system']),
      image_path: z.string().nullable(),
      spoken_at: z.string().datetime().nullable(),
    }),
  ),
});

/**
 * Arguments a write tool may carry. Restricted charset + bounds; the model
 * cannot inject arbitrary structure. `client_slug` is later resolved to a real
 * `client_id` against the `clients` table (unknown slug -> error).
 */
export const WriteToolArgs = z.object({
  client_slug: Slug,
  product_slug: Slug.optional(),
  // Optional human-supplied note, bounded; treated as data only.
  note: z.string().max(500).optional(),
});
export type WriteToolArgsT = z.infer<typeof WriteToolArgs>;
