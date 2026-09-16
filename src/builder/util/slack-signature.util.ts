import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Is this request really from Slack?
 *
 * The only thing standing between a public URL and "anyone on the internet can
 * merge to master and ship it". Slack signs every request with a shared secret
 * over the exact bytes it sent, and this is the check that the bytes, the
 * timestamp and the signature agree.
 *
 * Three properties, each load-bearing:
 *
 *  - **Raw bytes, not the parsed body.** Slack signs what it sent. A body
 *    re-serialised from the parsed object differs in key order and escaping,
 *    so it would never verify — which is why `main.ts` retains `rawBody` on the
 *    urlencoded parser.
 *  - **A timestamp window.** Without it a signature stays valid forever, and
 *    anyone who ever saw one request could replay it to merge the same pull
 *    request again. Five minutes is Slack's own published guidance.
 *  - **A constant-time compare.** A normal `===` leaks how much of a guess was
 *    right through timing, which is enough to forge a signature given enough
 *    attempts.
 *
 * Returns a reason rather than a bare false so a refusal can be logged
 * precisely: "no secret configured", "stale", and "bad signature" are three
 * very different operational problems and they look identical from a 401.
 */
export type SlackVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_configured' | 'malformed' | 'stale' | 'bad_signature';
    };

/** Slack's own guidance, and the window a replay has to land inside. */
export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export function verifySlackSignature(params: {
  signingSecret?: string | null;
  signature?: string | null;
  timestamp?: string | null;
  rawBody?: Buffer | string | null;
  now?: Date;
}): SlackVerificationResult {
  const { signingSecret, signature, timestamp, rawBody } = params;

  // Absent secret is "inbound Slack is switched off", not "allow". An endpoint
  // that merges to master must fail closed.
  if (!signingSecret) return { ok: false, reason: 'not_configured' };
  if (!signature || !timestamp || rawBody == null)
    return { ok: false, reason: 'malformed' };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'malformed' };

  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  // Absolute difference: a clock skewed into the future is as much a reason to
  // refuse as a replayed old request.
  if (Math.abs(nowSeconds - sent) > SLACK_SIGNATURE_MAX_AGE_SECONDS)
    return { ok: false, reason: 'stale' };

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal and an unhandled error on a public route.
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}
