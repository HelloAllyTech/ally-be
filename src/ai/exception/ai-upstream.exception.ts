import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import { ErrorCode } from '../../exception/error-code.enum';
import { messageForAiErrorCode } from '../../exception/failure-messages';

/**
 * What `AiService.makeRequest` throws when `throwError` is set.
 *
 * WHY A CLASS AND NOT `new Error(message)`
 * ----------------------------------------
 * ally-ai maps its own failures carefully — 502/503 for an unreachable model
 * provider, 429 for a throttled one, 4xx for a request it will never accept.
 * All of that used to be flattened here into `new Error(error.message)`, which
 * `CustomExceptionFilter` turns into a 500. Every caller therefore learned the
 * same thing from a dead service and a rejected payload: "500, unknown". The
 * retryable/terminal distinction — the only part a caller can actually act on —
 * was destroyed one line before it could be used.
 *
 * `message` is deliberately still the raw axios message, so the handful of
 * existing callers that log or inspect `error.message` behave exactly as before.
 * The classification rides alongside it.
 */
export class AiUpstreamError extends Error {
  constructor(
    message: string,
    /** Stable classification. Drives both the HTTP mapping and `retryable`. */
    readonly errorCode: ErrorCode,
    /** HTTP status ally-ai answered with, when it answered at all. */
    readonly upstreamStatus?: number,
    /** Node network errno (ECONNREFUSED / ECONNRESET / …) when it did not. */
    readonly networkCode?: string,
    /** Seconds ally-ai asked us to wait, from its `Retry-After` header. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AiUpstreamError';
  }

  /**
   * Whether repeating the SAME request could plausibly succeed.
   *
   * This is the distinction worth preserving through the layers: a caller that
   * cannot tell "the model provider is briefly down" from "this payload will
   * never be accepted" either retries forever or gives up immediately, and both
   * are wrong half the time.
   */
  get retryable(): boolean {
    return this.errorCode !== ErrorCode.AI_REQUEST_REJECTED;
  }
}

/** Seconds to suggest waiting when ally-ai throttles us without saying. */
const DEFAULT_THROTTLE_BACKOFF_SECONDS = 30;
/** Seconds to suggest waiting on a transient outage. */
const DEFAULT_UNAVAILABLE_BACKOFF_SECONDS = 10;

/**
 * Classify a raw axios failure from ally-ai / ally-ai-learn.
 *
 * Ordering matters: a timeout carries no response, so it has to be recognised
 * before the "no status ⇒ unreachable" fallback, otherwise every slow call is
 * reported as a dead service.
 */
export function classifyAiFailure(error: unknown): AiUpstreamError {
  if (error instanceof AiUpstreamError) return error;

  const axiosErr = error as AxiosError;
  const message =
    (error as Error)?.message ?? 'ally-ai request failed for an unknown reason';
  const upstreamStatus = axiosErr?.response?.status;
  const networkCode = (error as NodeJS.ErrnoException)?.code;

  // ally-ai's own Retry-After, when it bothered to send one. Preferred over any
  // number we would invent, because it is the only one that knows the real
  // window.
  const rawRetryAfter = axiosErr?.response?.headers?.['retry-after'];
  const parsedRetryAfter = Number(rawRetryAfter);
  const upstreamRetryAfter =
    Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
      ? Math.ceil(parsedRetryAfter)
      : undefined;

  const build = (code: ErrorCode, retryAfterSeconds?: number) =>
    new AiUpstreamError(
      message,
      code,
      upstreamStatus,
      networkCode,
      upstreamRetryAfter ?? retryAfterSeconds,
    );

  // axios reports its own `timeout` as ECONNABORTED (and ETIMEDOUT for a socket
  // timeout). Both mean "we gave up waiting", which is transient and is NOT the
  // same as "nothing is listening".
  if (
    networkCode === 'ECONNABORTED' ||
    networkCode === 'ETIMEDOUT' ||
    axiosErr?.code === 'ECONNABORTED' ||
    axiosErr?.code === 'ETIMEDOUT'
  ) {
    return build(
      ErrorCode.AI_SERVICE_TIMEOUT,
      DEFAULT_UNAVAILABLE_BACKOFF_SECONDS,
    );
  }

  if (upstreamStatus === HttpStatus.TOO_MANY_REQUESTS) {
    return build(
      ErrorCode.AI_SERVICE_THROTTLED,
      DEFAULT_THROTTLE_BACKOFF_SECONDS,
    );
  }

  if (upstreamStatus === HttpStatus.GATEWAY_TIMEOUT) {
    return build(
      ErrorCode.AI_SERVICE_TIMEOUT,
      DEFAULT_UNAVAILABLE_BACKOFF_SECONDS,
    );
  }

  if (upstreamStatus !== undefined && upstreamStatus >= 500) {
    // Includes a plain 500: an unhandled error inside ally-ai is usually
    // transient (a model provider hiccup surfacing as a traceback), and treating
    // it as terminal would stop retries that routinely succeed.
    return build(
      ErrorCode.AI_SERVICE_UNAVAILABLE,
      DEFAULT_UNAVAILABLE_BACKOFF_SECONDS,
    );
  }

  if (upstreamStatus !== undefined && upstreamStatus >= 400) {
    // ally-ai understood us and refused. Retrying the identical request is
    // guaranteed to fail again, so this is the one TERMINAL category.
    return build(ErrorCode.AI_REQUEST_REJECTED);
  }

  // No response at all: ECONNREFUSED, DNS failure, TLS failure, socket reset.
  return build(
    ErrorCode.AI_SERVICE_UNAVAILABLE,
    DEFAULT_UNAVAILABLE_BACKOFF_SECONDS,
  );
}

/**
 * Predicate for `RetryWithinBudget`: is repeating this request worth a retry?
 *
 * Everything transient is; a 4xx ally-ai already refused is not. Written as a
 * standalone function rather than a lambda at the call site so the decorator
 * metadata stays readable and the rule has one definition.
 */
export function isRetryableAiFailure(error: unknown): boolean {
  return classifyAiFailure(error).retryable;
}

/**
 * Turn an ally-ai failure into the HTTP response a client should see.
 *
 * The status is chosen so that the retryable/terminal distinction survives all
 * the way to the browser or mobile client:
 *   - 503 — transient outage, retry with backoff
 *   - 504 — we gave up waiting, retry
 *   - 429 — throttled, retry after `Retry-After`
 *   - 400 — ally-ai refused this request; do NOT retry it unchanged
 *
 * `operation` is a short internal label (e.g. `nudge`, `speaker identification`)
 * that goes into the `error` field for triage. It never carries user content.
 */
export function aiFailureToHttpException(
  error: unknown,
  operation: string,
): HttpException {
  const failure = classifyAiFailure(error);
  const body = {
    message: messageForAiErrorCode(failure.errorCode),
    error: `AI ${operation} failed`,
    errorCode: failure.errorCode,
    ...(failure.retryAfterSeconds !== undefined && {
      retryAfterSeconds: failure.retryAfterSeconds,
    }),
  };

  switch (failure.errorCode) {
    case ErrorCode.AI_SERVICE_THROTTLED:
      return new HttpException(
        { ...body, statusCode: HttpStatus.TOO_MANY_REQUESTS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    case ErrorCode.AI_SERVICE_TIMEOUT:
      return new GatewayTimeoutException({
        ...body,
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
      });
    case ErrorCode.AI_REQUEST_REJECTED:
      return new BadRequestException({
        ...body,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    default:
      return new ServiceUnavailableException({
        ...body,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      });
  }
}
