/**
 * Wake-word configuration helper (SPEC-016 §"wake-word").
 *
 * The wake word ("Nexus") runs entirely client-side via Picovoice. The only
 * value the browser needs is the public Picovoice access key
 * (`NEXT_PUBLIC_PICOVOICE_ACCESS_KEY`) — a client key, not a backend secret.
 * This helper just normalizes the config; the actual detection is in the
 * client component. Treating the absence of a key as "disabled" keeps the app
 * working offline.
 */
export interface WakeWordConfig {
  enabled: boolean;
  keyword: 'nexus';
  accessKey: string | null;
}

export function buildWakeWordConfig(accessKey: string | undefined): WakeWordConfig {
  const trimmed = accessKey?.trim() ?? '';
  return {
    enabled: trimmed.length > 0,
    keyword: 'nexus',
    accessKey: trimmed.length > 0 ? trimmed : null,
  };
}
