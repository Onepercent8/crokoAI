import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import type { LlmClient, LlmContentBlock, LlmRequest, LlmResponse } from './llm';

/**
 * Anthropic adapter for {@link LlmClient} (SPEC-016 §"Modelos").
 *
 * Server-only. The API key comes from `lib/env` (never a literal, never
 * `NEXT_PUBLIC_*`). Adaptive thinking is enabled (recommended on Sonnet 4.6 /
 * Opus-tier); we do not set sampling params (rejected on recent models).
 *
 * This is the production implementation; tests inject a fake LlmClient instead,
 * so this file is never exercised offline.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async createMessage(req: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        // Thinking is left at the model default (adaptive on recent models). We
        // do not set sampling params (rejected on Opus-tier / Sonnet 4.6).
        system: req.system,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content.map(toAnthropicBlock),
        })),
      });
      return {
        stopReason: response.stop_reason ?? 'end_turn',
        content: response.content.map(fromAnthropicBlock),
      };
    } catch (error) {
      // Structured, no-PII rethrow (.claude/rules/code-style.md).
      throw new Error(`Failed to create Nexus message: ${(error as Error).message}`);
    }
  }
}

function toAnthropicBlock(block: LlmContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error ?? false,
      };
  }
}

function fromAnthropicBlock(block: Anthropic.ContentBlock): LlmContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: (block.input ?? {}) as Record<string, unknown>,
    };
  }
  // Thinking and other block types are not surfaced to the loop; ignore as text.
  return { type: 'text', text: '' };
}
