import { HELPLINE_WAIT_ESTIMATE } from '../constants/helpline.constants';

/**
 * Estimated wait in whole minutes: the median of the most recent claimed waits
 * (seconds), or null with fewer than MIN_SAMPLES — a guess from two chats is
 * worse than saying nothing. Never below 1: "0 minutes" reads as a promise.
 */
export function estimateWaitMinutes(waitSeconds: number[]): number | null {
  const samples = waitSeconds
    .filter((s) => Number.isFinite(s) && s >= 0)
    .slice(0, HELPLINE_WAIT_ESTIMATE.SAMPLE_SIZE)
    .sort((a, b) => a - b);
  if (samples.length < HELPLINE_WAIT_ESTIMATE.MIN_SAMPLES) return null;
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 0
      ? (samples[mid - 1] + samples[mid]) / 2
      : samples[mid];
  return Math.max(1, Math.round(median / 60));
}
