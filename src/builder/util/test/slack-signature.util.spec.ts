import { createHmac } from 'node:crypto';
import {
  SLACK_SIGNATURE_MAX_AGE_SECONDS,
  verifySlackSignature,
} from '../slack-signature.util';

/**
 * The security boundary for merging to master from a chat message.
 *
 * Everything else in the Slack feature is convenience. This is the part where
 * being wrong means a public URL that ships to production for anyone who finds
 * it, so each case below is an attack it has to refuse.
 */
describe('verifySlackSignature', () => {
  const secret = 'shhh';
  const body = 'payload=%7B%22ok%22%3Atrue%7D';
  const now = new Date('2026-09-16T10:00:00Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));

  const sign = (ts: string, rawBody: string, key = secret) =>
    `v0=${createHmac('sha256', key).update(`v0:${ts}:${rawBody}`).digest('hex')}`;

  it('accepts a genuine Slack request', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(timestamp, body),
        timestamp,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts the raw bytes as a Buffer, which is how express hands them over', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(timestamp, body),
        timestamp,
        rawBody: Buffer.from(body, 'utf8'),
        now,
      }).ok,
    ).toBe(true);
  });

  /**
   * Fail closed. An unset secret means inbound Slack was never switched on,
   * and an endpoint that merges to master must not treat "unconfigured" as
   * "unrestricted".
   */
  it('refuses everything when no secret is configured', () => {
    expect(
      verifySlackSignature({
        signingSecret: undefined,
        signature: sign(timestamp, body),
        timestamp,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('refuses a forged signature', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(timestamp, body, 'wrong-secret'),
        timestamp,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  /**
   * The whole reason the raw body is retained: a signature over the bytes
   * Slack sent must not verify against a body that changed in transit.
   */
  it('refuses when the body does not match what was signed', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(timestamp, body),
        timestamp,
        rawBody: 'payload=%7B%22ok%22%3Afalse%7D',
        now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  /** Without the window, one captured request merges the same PR forever. */
  it('refuses a replayed request from outside the window', () => {
    const old = String(
      Math.floor(now.getTime() / 1000) - SLACK_SIGNATURE_MAX_AGE_SECONDS - 1,
    );
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(old, body),
        timestamp: old,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });

  /** A clock skewed into the future is as much a reason to refuse. */
  it('refuses a timestamp from the future', () => {
    const ahead = String(
      Math.floor(now.getTime() / 1000) + SLACK_SIGNATURE_MAX_AGE_SECONDS + 1,
    );
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(ahead, body),
        timestamp: ahead,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });

  it('refuses a request missing its headers rather than throwing', () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: null,
        timestamp: null,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  /**
   * A length mismatch would make `timingSafeEqual` throw, which is both an
   * unhandled error on a public route and a timing signal of its own.
   */
  it('refuses a truncated signature rather than throwing', () => {
    expect(() =>
      verifySlackSignature({
        signingSecret: secret,
        signature: 'v0=deadbeef',
        timestamp,
        rawBody: body,
        now,
      }),
    ).not.toThrow();
  });
});
