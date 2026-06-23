import type { Destination, FanoutContext, Logger } from './ports.js';

/**
 * Marketing fan-out (SPEC-015 §Comportamento, step 6).
 *
 * Each destination (Meta CAPI, GA4 Measurement Protocol, Google Ads) implements
 * `Destination` and receives only hashed user_data (no raw PII). Tokens live in
 * Wrangler secrets and are injected via the constructed adapter — never logged.
 *
 * Fan-out is best-effort and isolated: a failing destination is logged (NO-PII)
 * and never blocks the others nor the NO-PII mirror write.
 */

/** Minimal fetch surface (injectable for tests). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number }>;

/** Run all destinations, isolating per-destination failures. */
export async function fanOut(
  destinations: readonly Destination[],
  ctx: FanoutContext,
  logger: Logger,
): Promise<void> {
  await Promise.all(
    destinations.map(async (destination) => {
      try {
        await destination.send(ctx);
      } catch (error) {
        // NO-PII: log only the destination name + event_id + a short reason.
        logger.error(`fanout destination failed: ${destination.name}`, {
          event_id: ctx.event.event_id,
          reason: (error as Error).message,
        });
      }
    }),
  );
}

/** Meta Conversions API destination. Reuses `event_id` for pixel<->CAPI dedup. */
export class MetaCapiDestination implements Destination {
  readonly name = 'meta_capi';
  constructor(private readonly cfg: { pixelId: string; token: string; fetchImpl: FetchLike }) {}

  async send(ctx: FanoutContext): Promise<void> {
    const userData: Record<string, string> = {};
    if (ctx.hashed.emailSha256 !== undefined) userData['em'] = ctx.hashed.emailSha256;
    if (ctx.hashed.phoneSha256 !== undefined) userData['ph'] = ctx.hashed.phoneSha256;
    const body = {
      data: [
        {
          event_name: ctx.event.event_type,
          event_time: Math.floor(Date.parse(ctx.event.occurred_at) / 1000),
          event_id: ctx.event.event_id,
          action_source: 'website',
          user_data: userData,
          custom_data: {
            ...(ctx.event.value_cents !== undefined ? { value: ctx.event.value_cents / 100 } : {}),
            ...(ctx.event.currency !== undefined ? { currency: ctx.event.currency } : {}),
          },
        },
      ],
    };
    const url = `https://graph.facebook.com/v25.0/${this.cfg.pixelId}/events?access_token=${encodeURIComponent(this.cfg.token)}`;
    const res = await this.cfg.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`CAPI status ${res.status}`);
    }
  }
}

/** GA4 Measurement Protocol destination. */
export class Ga4Destination implements Destination {
  readonly name = 'ga4';
  constructor(
    private readonly cfg: { measurementId: string; apiSecret: string; fetchImpl: FetchLike },
  ) {}

  async send(ctx: FanoutContext): Promise<void> {
    const body = {
      client_id: ctx.event.event_id,
      events: [
        {
          name: ctx.event.event_type,
          params: {
            ...(ctx.event.value_cents !== undefined ? { value: ctx.event.value_cents / 100 } : {}),
            ...(ctx.event.currency !== undefined ? { currency: ctx.event.currency } : {}),
          },
        },
      ],
    };
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(this.cfg.measurementId)}&api_secret=${encodeURIComponent(this.cfg.apiSecret)}`;
    const res = await this.cfg.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GA4 status ${res.status}`);
    }
  }
}

/** Google Ads offline conversion destination (purchase events). */
export class GoogleAdsDestination implements Destination {
  readonly name = 'google_ads';
  constructor(
    private readonly cfg: {
      conversionId: string;
      conversionLabel: string;
      developerToken: string;
      fetchImpl: FetchLike;
    },
  ) {}

  async send(ctx: FanoutContext): Promise<void> {
    // Only purchase events are forwarded as conversions.
    if (ctx.event.event_type !== 'purchase') {
      return;
    }
    const body = {
      conversion_id: this.cfg.conversionId,
      conversion_label: this.cfg.conversionLabel,
      order_id: ctx.event.event_id,
      ...(ctx.event.value_cents !== undefined ? { value_cents: ctx.event.value_cents } : {}),
      ...(ctx.event.currency !== undefined ? { currency: ctx.event.currency } : {}),
      ...(ctx.hashed.emailSha256 !== undefined ? { hashed_email: ctx.hashed.emailSha256 } : {}),
    };
    const res = await this.cfg.fetchImpl(
      'https://googleads.googleapis.com/v18/conversions:upload',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'developer-token': this.cfg.developerToken,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Google Ads status ${res.status}`);
    }
  }
}
