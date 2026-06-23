import { describe, expect, it } from 'vitest';

import {
  CaptureRequest,
  ChatRequest,
  ConfirmRequest,
  Slug,
  TtsRequest,
  WriteToolArgs,
} from '../lib/nexus/schemas';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('nexus Zod schemas (boundary validation)', () => {
  it('ChatRequest requires a uuid session and bounded message', () => {
    expect(ChatRequest.safeParse({ session_id: UUID, message: 'oi' }).success).toBe(true);
    expect(ChatRequest.safeParse({ session_id: 'x', message: 'oi' }).success).toBe(false);
    expect(ChatRequest.safeParse({ session_id: UUID, message: '' }).success).toBe(false);
    expect(ChatRequest.safeParse({ session_id: UUID, message: 'a'.repeat(4001) }).success).toBe(
      false,
    );
  });

  it('ConfirmRequest requires uuid session + action id', () => {
    expect(ConfirmRequest.safeParse({ session_id: UUID, action_id: UUID }).success).toBe(true);
    expect(ConfirmRequest.safeParse({ session_id: UUID, action_id: 'nope' }).success).toBe(false);
  });

  it('Slug enforces the restricted charset', () => {
    expect(Slug.safeParse('cliente-exemplo').success).toBe(true);
    expect(Slug.safeParse('Cliente Exemplo').success).toBe(false);
    expect(Slug.safeParse('a; drop table').success).toBe(false);
    expect(Slug.safeParse('').success).toBe(false);
  });

  it('WriteToolArgs requires a client slug and bounds the note', () => {
    expect(WriteToolArgs.safeParse({ client_slug: 'cliente-exemplo' }).success).toBe(true);
    expect(WriteToolArgs.safeParse({ client_slug: 'x', note: 'a'.repeat(501) }).success).toBe(
      false,
    );
    expect(WriteToolArgs.safeParse({}).success).toBe(false);
  });

  it('TtsRequest bounds the text', () => {
    expect(TtsRequest.safeParse({ text: 'fala' }).success).toBe(true);
    expect(TtsRequest.safeParse({ text: '' }).success).toBe(false);
  });

  it('CaptureRequest only accepts an image data URL', () => {
    expect(
      CaptureRequest.safeParse({ session_id: UUID, image: 'data:image/png;base64,AAAA' }).success,
    ).toBe(true);
    expect(
      CaptureRequest.safeParse({ session_id: UUID, image: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      CaptureRequest.safeParse({ session_id: UUID, image: 'data:text/html;base64,AAAA' }).success,
    ).toBe(false);
  });
});
