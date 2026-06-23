import 'server-only';

import { getServerEnv } from '../env';
import { runChatTurn, type ChatTurnInput, type ChatTurnResult } from './chat-loop';
import { confirmAction } from './confirm';
import { supabaseJobInserter } from './job-inserter';
import { AnthropicLlmClient } from './llm-anthropic';
import { InMemorySessionMemory } from './memory';
import { InMemoryPendingActionStore } from './pending-action';
import { buildSystemPrompt } from './prompt';
import { readToolHandlers, resolveClientId } from './read-tools';
import { InMemoryScreenContextStore } from './screen-context';
import type { ConfirmResponseT } from './schemas';
import { WhisperSttClient, type SttClient } from './stt';
import { ElevenLabsTtsClient, type TtsClient } from './tts';

/**
 * Server-side runtime assembly for the Nexus surface (SPEC-016).
 *
 * Wires the singletons (memory, pending-action store, LLM/STT/TTS clients) from
 * `lib/env`. In-memory stores are fine for a single serverless instance; they
 * can be swapped for Redis-backed implementations behind the same interfaces.
 *
 * Routes call these functions; the heavy lib code (chat-loop, confirm) is pure
 * and tested directly with fakes — this module is the only place that reads env
 * / instantiates providers, so it is never exercised offline.
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const DEFAULT_VOICE_ID = 'Rachel';

const memory = new InMemorySessionMemory();
const pendingActions = new InMemoryPendingActionStore();
const screenContext = new InMemoryScreenContextStore();

function now(): number {
  return Date.now();
}
function newId(): string {
  return crypto.randomUUID();
}

let cachedLlm: AnthropicLlmClient | undefined;
function getLlm(): AnthropicLlmClient {
  if (cachedLlm === undefined) {
    const env = getServerEnv();
    if (env.CLAUDE_API_KEY === undefined) {
      throw new Error('Nexus chat is not configured: CLAUDE_API_KEY is absent');
    }
    cachedLlm = new AnthropicLlmClient(env.CLAUDE_API_KEY);
  }
  return cachedLlm;
}

/** Run one Nexus chat turn (reads execute directly; writes only propose). */
export async function nexusChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const env = getServerEnv();
  return runChatTurn(
    {
      llm: getLlm(),
      memory,
      pendingActions,
      readTools: readToolHandlers,
      resolveClientId,
      model: env.NEXUS_MODEL ?? DEFAULT_MODEL,
      maxTokens: MAX_TOKENS,
      systemPrompt: buildSystemPrompt(),
      now,
      newId,
    },
    input,
  );
}

/** Confirm a proposed write (second turn) -> enqueue into agent_jobs. */
export async function nexusConfirm(sessionId: string, actionId: string): Promise<ConfirmResponseT> {
  return confirmAction({ pendingActions, inserter: supabaseJobInserter, now }, sessionId, actionId);
}

/** Store an ephemeral screen-capture frame -> screen_context_id. */
export async function nexusCapture(sessionId: string, normalizedText: string): Promise<string> {
  return screenContext.put(sessionId, normalizedText, now(), newId);
}

/** Read a previously captured frame for a session (or null if expired). */
export async function nexusReadCapture(
  sessionId: string,
  contextId: string,
): Promise<string | null> {
  return screenContext.get(sessionId, contextId, now());
}

let cachedStt: SttClient | undefined;
export function getSttClient(): SttClient {
  if (cachedStt === undefined) {
    const env = getServerEnv();
    if (env.OPENAI_API_KEY === undefined) {
      throw new Error('Nexus STT is not configured: OPENAI_API_KEY is absent');
    }
    cachedStt = new WhisperSttClient(env.OPENAI_API_KEY);
  }
  return cachedStt;
}

let cachedTts: TtsClient | undefined;
export function getTtsClient(): TtsClient {
  if (cachedTts === undefined) {
    const env = getServerEnv();
    if (env.ELEVENLABS_API_KEY === undefined) {
      throw new Error('Nexus TTS is not configured: ELEVENLABS_API_KEY is absent');
    }
    cachedTts = new ElevenLabsTtsClient(env.ELEVENLABS_API_KEY);
  }
  return cachedTts;
}

/** The configured TTS voice id (defaults to a placeholder voice). */
export function getTtsVoiceId(): string {
  return getServerEnv().ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
}
