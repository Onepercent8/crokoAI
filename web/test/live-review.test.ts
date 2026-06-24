import { describe, expect, it } from 'vitest';

import { runLiveReview, type LiveReviewDeps, type OpinionPort } from '../lib/nexus/live-review';
import {
  assertSafeUrl,
  captureReviewFrame,
  isSafeUrl,
  SsrfBlockedError,
  type FrameCapturePort,
} from '../lib/nexus/review-frame';

const WATCH = '11111111-1111-1111-1111-111111111111';

describe('SSRF guard: assertSafeUrl', () => {
  it('accepts an https host inside *.example.com', () => {
    expect(assertSafeUrl('https://promo.example.com/')).toBe('https://promo.example.com/');
    expect(isSafeUrl('https://a.b.example.com/x')).toBe(true);
  });

  it('rejects http (non-https)', () => {
    expect(() => assertSafeUrl('http://promo.example.com')).toThrow(SsrfBlockedError);
  });

  it('rejects localhost and *.localhost', () => {
    expect(() => assertSafeUrl('https://localhost')).toThrow(/localhost/);
    expect(() => assertSafeUrl('https://api.localhost')).toThrow(/localhost/);
  });

  it('rejects literal IPv4 including cloud metadata', () => {
    expect(() => assertSafeUrl('https://127.0.0.1')).toThrow(/ipv4/);
    expect(() => assertSafeUrl('https://169.254.169.254/latest/meta-data')).toThrow(/ipv4/);
  });

  it('rejects literal IPv6', () => {
    expect(() => assertSafeUrl('https://[::1]/')).toThrow(SsrfBlockedError);
  });

  it('rejects an arbitrary host outside the allowlist', () => {
    expect(() => assertSafeUrl('https://evil.com')).toThrow(/allowlist/);
  });

  it('rejects a confusable suffix (example.com.evil.com)', () => {
    expect(() => assertSafeUrl('https://example.com.evil.com')).toThrow(/allowlist/);
  });

  it('rejects a malformed url', () => {
    expect(() => assertSafeUrl('not a url')).toThrow(SsrfBlockedError);
  });
});

describe('captureReviewFrame: degrades safely, never throws', () => {
  const okPort: FrameCapturePort = {
    async capture() {
      return { imagePath: 'nexus-review/frame.png' };
    },
  };
  const throwingPort: FrameCapturePort = {
    async capture() {
      throw new Error('render timeout');
    },
  };

  it('captures for a safe url', async () => {
    const res = await captureReviewFrame(okPort, { watchId: WATCH, url: 'https://x.example.com' });
    expect(res).toEqual({ status: 'captured', imagePath: 'nexus-review/frame.png' });
  });

  it('blocks an unsafe url BEFORE invoking the capture port', async () => {
    let called = false;
    const spyPort: FrameCapturePort = {
      async capture() {
        called = true;
        return { imagePath: 'x' };
      },
    };
    const res = await captureReviewFrame(spyPort, { watchId: WATCH, url: 'https://evil.com' });
    expect(res.status).toBe('blocked');
    expect(called).toBe(false); // never navigated
  });

  it('maps a capture error to a soft failure (no throw)', async () => {
    const res = await captureReviewFrame(throwingPort, {
      watchId: WATCH,
      url: 'https://x.example.com',
    });
    expect(res.status).toBe('failed');
  });
});

describe('runLiveReview: capture + opinion orchestration', () => {
  const capture: FrameCapturePort = {
    async capture() {
      return { imagePath: 'nexus-review/f.png' };
    },
  };

  it('produces an opinion outcome on the happy path', async () => {
    const opinion: OpinionPort = {
      async opine() {
        return { text: 'CTA acima da dobra, bom.' };
      },
    };
    const deps: LiveReviewDeps = { capture, opinion };
    const out = await runLiveReview(deps, { watchId: WATCH, url: 'https://x.example.com' });
    expect(out.kind).toBe('opinion');
    if (out.kind === 'opinion') {
      expect(out.imagePath).toBe('nexus-review/f.png');
    }
  });

  it('returns blocked when the url is outside the allowlist', async () => {
    const opinion: OpinionPort = {
      async opine() {
        return { text: 'x' };
      },
    };
    const out = await runLiveReview(
      { capture, opinion },
      { watchId: WATCH, url: 'https://evil.com' },
    );
    expect(out.kind).toBe('blocked');
  });

  it('degrades when the opinion model throws', async () => {
    const opinion: OpinionPort = {
      async opine() {
        throw new Error('model unavailable');
      },
    };
    const out = await runLiveReview(
      { capture, opinion },
      { watchId: WATCH, url: 'https://x.example.com' },
    );
    expect(out.kind).toBe('failed');
  });

  it('treats an empty opinion as a failure', async () => {
    const opinion: OpinionPort = {
      async opine() {
        return { text: '   ' };
      },
    };
    const out = await runLiveReview(
      { capture, opinion },
      { watchId: WATCH, url: 'https://x.example.com' },
    );
    expect(out.kind).toBe('failed');
  });
});
