/**
 * Why a provider call failed, in the only terms a caller can act on.
 *
 * Every agent call site ends up needing the same four decisions from a thrown
 * SDK error — is this worth retrying, does it need an administrator, is the
 * request itself too big, or is it none of those — and none of them can be
 * read off the raw error without knowing three vendors' error shapes. The
 * shapes disagree in ways that matter: Anthropic reports an exhausted balance
 * as a `400 invalid_request_error`, which reads as a malformed request, while
 * OpenAI reports the same condition as a `429`, which reads as a rate limit
 * worth retrying. Both are wrong to act on.
 *
 * The classification is deliberately coarse. It is not a diagnosis — the raw
 * error still goes to the log via `describeAgentProviderError` for whoever is
 * actually debugging — it is only enough to pick the right message and the
 * right advice for the person whose turn just failed.
 */
export enum AgentProviderFailure {
  /** Credit, quota or billing exhausted. An administrator, not a retry. */
  QUOTA = 'quota',
  /** Key missing, invalid, revoked or not entitled to the model. */
  AUTH = 'auth',
  /** Throttled. Transient by definition — the same request will work later. */
  RATE_LIMIT = 'rate_limit',
  /** Overloaded, 5xx or unreachable. Transient, but not the caller's doing. */
  UNAVAILABLE = 'unavailable',
  /** The request itself exceeds what the model will accept. Retrying repeats it. */
  REQUEST_TOO_LARGE = 'request_too_large',
  /** Anything unrecognised, including our own thrown errors. */
  UNKNOWN = 'unknown',
}

const asRecord = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object'
    ? (value as Record<string, any>)
    : undefined;

/**
 * The nested payloads worth reading off one thrown error.
 *
 * All three SDKs bury the useful fields at a different depth — Anthropic and
 * OpenAI hang an `error` object off the exception, Google's wraps the upstream
 * body, and a transport failure arrives as a bare `Error` with a `cause`. The
 * depth cap is a loop guard, not a limit anything real reaches.
 */
const errorLayers = (error: unknown): Record<string, any>[] => {
  const layers: Record<string, any>[] = [];
  let node = asRecord(error);
  for (let depth = 0; node && depth < 4; depth += 1) {
    layers.push(node);
    node =
      asRecord(node.error) ??
      asRecord(asRecord(node.response)?.data)?.error ??
      asRecord(node.cause);
  }
  return layers;
};

/** Every machine-readable label the layers carry, lowercased. */
const tokensOf = (layers: Record<string, any>[]): Set<string> =>
  new Set(
    layers
      .flatMap((layer) => [layer.code, layer.type, layer.reason, layer.status])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase()),
  );

/** The first numeric HTTP status any layer carries. */
const statusOf = (layers: Record<string, any>[]): number | undefined =>
  layers
    .map((layer) => layer.status ?? layer.statusCode)
    .find((value): value is number => typeof value === 'number');

/** Every message text the layers carry, lowercased and concatenated. */
const messageOf = (layers: Record<string, any>[]): string =>
  layers
    .map((layer) => layer.message)
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

// Tokens are matched before status codes throughout, because the status alone
// is misleading for exactly the case that prompted this: OpenAI's
// `insufficient_quota` is a 429 and must not be retried as a rate limit.
const QUOTA_TOKENS = [
  'insufficient_quota',
  'billing_not_active',
  'billing_hard_limit_reached',
  'quota_exceeded',
  'credit_balance_too_low',
];
const QUOTA_PATTERNS = [
  'credit balance',
  'insufficient_quota',
  'exceeded your current quota',
  'purchase credits',
  'plans & billing',
  'billing',
];

const AUTH_TOKENS = [
  'authentication_error',
  'invalid_api_key',
  'permission_error',
  'permission_denied',
  'unauthenticated',
  'invalid_authentication',
];
const AUTH_PATTERNS = [
  'api key',
  'api-key',
  'authentication',
  'unauthorized',
  'not authorized',
];
const AUTH_STATUSES = [401, 403];

const TOO_LARGE_TOKENS = ['context_length_exceeded', 'string_above_max_length'];
const TOO_LARGE_PATTERNS = [
  'context length',
  'context window',
  'prompt is too long',
  'too many tokens',
  'request too large',
  'payload too large',
];
const TOO_LARGE_STATUSES = [413];

// Gemini reports both a per-minute throttle and an exhausted daily allowance
// as RESOURCE_EXHAUSTED. Treated as a throttle here: the throttle is far the
// commoner of the two, and the message it produces ("try again shortly") is
// the safer of the two to be wrong with. The quota patterns above still catch
// the billing-shaped wording when Google supplies it.
const RATE_LIMIT_TOKENS = [
  'rate_limit_error',
  'rate_limit_exceeded',
  'resource_exhausted',
  'too_many_requests',
];
const RATE_LIMIT_PATTERNS = ['rate limit', 'too many requests'];
const RATE_LIMIT_STATUSES = [429];

const UNAVAILABLE_TOKENS = [
  'overloaded_error',
  'api_error',
  'unavailable',
  'internal',
  'deadline_exceeded',
  // Node transport failures arrive as an `Error` with one of these in `code`.
  'econnreset',
  'econnrefused',
  'etimedout',
  'enotfound',
  'epipe',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
];
const UNAVAILABLE_PATTERNS = [
  'overloaded',
  'fetch failed',
  'socket hang up',
  'network',
  'timed out',
  'timeout',
];
const UNAVAILABLE_STATUSES = [408, 500, 502, 503, 504, 529];

/**
 * Which kind of failure a thrown provider error represents.
 *
 * Order is the whole design: quota outranks both auth and rate limiting
 * because its wording and its status code each collide with one of them, and
 * an unrecognised error is reported as unknown rather than guessed at.
 */
export const classifyAgentProviderError = (
  error: unknown,
): AgentProviderFailure => {
  const layers = errorLayers(error);
  const tokens = tokensOf(layers);
  const status = statusOf(layers);
  const message = messageOf(layers);

  const matches = (
    kindTokens: string[],
    patterns: string[],
    statuses: number[] = [],
  ): boolean =>
    kindTokens.some((token) => tokens.has(token)) ||
    patterns.some((pattern) => message.includes(pattern)) ||
    (status !== undefined && statuses.includes(status));

  if (matches(QUOTA_TOKENS, QUOTA_PATTERNS)) {
    return AgentProviderFailure.QUOTA;
  }
  if (matches(AUTH_TOKENS, AUTH_PATTERNS, AUTH_STATUSES)) {
    return AgentProviderFailure.AUTH;
  }
  if (matches(TOO_LARGE_TOKENS, TOO_LARGE_PATTERNS, TOO_LARGE_STATUSES)) {
    return AgentProviderFailure.REQUEST_TOO_LARGE;
  }
  if (matches(RATE_LIMIT_TOKENS, RATE_LIMIT_PATTERNS, RATE_LIMIT_STATUSES)) {
    return AgentProviderFailure.RATE_LIMIT;
  }
  if (matches(UNAVAILABLE_TOKENS, UNAVAILABLE_PATTERNS, UNAVAILABLE_STATUSES)) {
    return AgentProviderFailure.UNAVAILABLE;
  }
  return AgentProviderFailure.UNKNOWN;
};

/** Longest raw provider message worth putting in one log line. */
const LOG_MESSAGE_LIMIT = 600;

/**
 * The raw error, flattened for a log line.
 *
 * This is the counterpart to hiding the error from the UI: the vendor's own
 * words are exactly what someone debugging needs, so they must survive
 * somewhere. Here, where only operators read them.
 */
export const describeAgentProviderError = (error: unknown): string => {
  const layers = errorLayers(error);
  const status = statusOf(layers);
  const tokens = [...tokensOf(layers)];
  const raw = error instanceof Error ? error.message : String(error);
  const message =
    raw.length > LOG_MESSAGE_LIMIT
      ? `${raw.slice(0, LOG_MESSAGE_LIMIT)}…`
      : raw;

  const prefix = [
    status !== undefined ? `status=${status}` : undefined,
    tokens.length > 0 ? `tokens=${tokens.join(',')}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return prefix ? `${prefix} ${message}` : message;
};
