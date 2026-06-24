import type { NotifyOutcome } from './autonomous-mode';

/**
 * notify — best-effort external notification for the `notifying` phase
 * (SPEC-013/014). Email (Resend) or Telegram. ANY failure DEGRADES TO LOG and
 * resolves `{delivered:false, degradedToLog:true}` — it NEVER throws and NEVER
 * marks the watch `failed` (fail-safe invariant, ADR 0019).
 *
 * The transport is an injectable port (real Resend/Telegram client in prod, fake
 * in tests). Messages carry NO PII (SPEC-000 §11).
 */

export interface NotifyMessage {
  subject: string;
  /** Plain-text body; no PII. */
  body: string;
  /** Optional storage path of the review frame (referenced, not inlined). */
  imagePath?: string;
}

/** Transport that actually delivers the notification (may throw/reject). */
export interface NotifyTransport {
  send(message: NotifyMessage): Promise<void>;
}

/**
 * Deliver best-effort. Catches every error and maps it to a degraded outcome,
 * logging structured + without PII. A missing transport is also a degraded
 * (not failed) outcome so the machine still closes.
 */
export async function notifyBestEffort(
  transport: NotifyTransport | null,
  message: NotifyMessage,
): Promise<NotifyOutcome> {
  if (transport === null) {
    console.error(
      JSON.stringify({ level: 'info', op: 'notify.skip', reason: 'no transport configured' }),
    );
    return { delivered: false, degradedToLog: true };
  }
  try {
    await transport.send(message);
    return { delivered: true };
  } catch (error) {
    // Fail-safe: degrade to log; never propagate so the watch is not failed.
    console.error(
      JSON.stringify({
        level: 'warn',
        op: 'notify.degraded',
        message: (error as Error).message,
      }),
    );
    return { delivered: false, degradedToLog: true };
  }
}
