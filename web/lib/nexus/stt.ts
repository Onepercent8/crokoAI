import 'server-only';

/**
 * Speech-to-text behind an injectable interface (SPEC-016 §"stt").
 *
 * The OpenAI Whisper call sits behind {@link SttClient} so the route uses the
 * real provider while tests inject a fake (no network). Audio is transient: it
 * is transcribed and never persisted, and nothing here logs PII.
 */
export interface SttResult {
  text: string;
  durationMs: number;
}

export interface SttClient {
  /** Transcribe an audio blob. Rejects on provider failure / empty audio. */
  transcribe(audio: ArrayBuffer, contentType: string): Promise<SttResult>;
}

/** OpenAI Whisper adapter. Lazily uses `fetch`; never logs the audio/text. */
export class WhisperSttClient implements SttClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'whisper-1',
  ) {}

  async transcribe(audio: ArrayBuffer, contentType: string): Promise<SttResult> {
    try {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), 'audio');
      form.append('model', this.model);
      const started = Date.now();
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const json = (await res.json()) as { text?: string };
      const text = json.text ?? '';
      if (text.trim().length === 0) {
        throw new Error('empty transcription');
      }
      return { text, durationMs: Date.now() - started };
    } catch (error) {
      throw new Error(`Failed to transcribe audio: ${(error as Error).message}`);
    }
  }
}
