import type { ReviewOutcome } from './autonomous-mode';
import { captureReviewFrame, type FrameCapturePort, type FrameRequest } from './review-frame';

/**
 * live-review — turn a captured frame into an opinion narration (SPEC-014).
 *
 * Orchestrates the `reviewing` phase side effect: capture a frame (SSRF-guarded
 * in `review-frame`), then ask the review model for an opinion. The page frame
 * is UNTRUSTED DATA (visual prompt injection) — the opinion port treats it as
 * data, never instruction. Failure of either step degrades safely to a
 * non-opinion {@link ReviewOutcome} so the phase machine still advances.
 *
 * Pure orchestration over injectable ports (capture + opinion). The real opinion
 * port calls `NEXUS_REVIEW_MODEL`; tests inject a fake.
 */

/** Port that generates an opinion about a captured frame. */
export interface OpinionPort {
  /**
   * Produce a short, no-PII opinion about the page. `imagePath` references the
   * frame in the private `nexus-review` bucket. The implementation treats the
   * page content as untrusted data.
   */
  opine(input: { watchId: string; imagePath: string; pageUrl: string }): Promise<{ text: string }>;
}

export interface LiveReviewDeps {
  capture: FrameCapturePort;
  opinion: OpinionPort;
}

/**
 * Run the live review for one publish. Returns a {@link ReviewOutcome} consumed
 * by `decideTick` (reviewing phase). Never throws: SSRF block, capture failure,
 * and opinion failure all degrade to a safe, narratable outcome.
 */
export async function runLiveReview(
  deps: LiveReviewDeps,
  req: FrameRequest,
): Promise<ReviewOutcome> {
  const captured = await captureReviewFrame(deps.capture, req);
  if (captured.status === 'blocked') {
    return { kind: 'blocked', reason: captured.reason };
  }
  if (captured.status === 'failed') {
    return { kind: 'failed', reason: captured.reason };
  }

  try {
    const { text } = await deps.opinion.opine({
      watchId: req.watchId,
      imagePath: captured.imagePath,
      pageUrl: req.url,
    });
    if (text.trim().length === 0) {
      return { kind: 'failed', reason: 'empty opinion' };
    }
    return { kind: 'opinion', text, imagePath: captured.imagePath };
  } catch (error) {
    return { kind: 'failed', reason: (error as Error).message };
  }
}
