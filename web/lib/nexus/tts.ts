import 'server-only';

/**
 * Text-to-speech behind an injectable interface (SPEC-016 §"tts").
 *
 * ElevenLabs sits behind {@link TtsClient} so the route uses the real provider
 * while tests inject a fake (no network). On provider failure the caller
 * degrades to a text-only reply (SPEC-016 §"Casos de erro").
 */
export interface TtsResult {
  audio: ArrayBuffer;
  contentType: string;
}

export interface TtsClient {
  /** Synthesize speech for `text`. Rejects on provider failure. */
  synthesize(text: string, voiceId: string): Promise<TtsResult>;
}

/** ElevenLabs adapter. Never logs the text being spoken. */
export class ElevenLabsTtsClient implements TtsClient {
  constructor(private readonly apiKey: string) {}

  async synthesize(text: string, voiceId: string): Promise<TtsResult> {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        },
      );
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      return { audio: await res.arrayBuffer(), contentType: 'audio/mpeg' };
    } catch (error) {
      throw new Error(`Failed to synthesize speech: ${(error as Error).message}`);
    }
  }
}
