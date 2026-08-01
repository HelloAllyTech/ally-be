/**
 * Turn whatever a provider SDK threw into one readable line.
 *
 * Kept verbatim wherever possible. The provider's own wording is the useful
 * part — "The model `gpt-4o-mini` has been deprecated" tells an admin exactly
 * what to do, where a normalised "request failed" tells them nothing. Only the
 * shape is flattened, never the message.
 */
export const describeProviderError = (error: unknown): string => {
  if (error == null) return 'Unknown error';

  if (typeof error === 'string') return error;

  if (typeof error === 'object') {
    const candidate = error as Record<string, any>;

    // OpenAI / Anthropic SDK error shapes.
    const nested =
      candidate.error?.message ??
      candidate.response?.data?.error?.message ??
      candidate.body?.error?.message;
    if (typeof nested === 'string' && nested.trim()) {
      return withStatus(
        nested.trim(),
        candidate.status ?? candidate.statusCode,
      );
    }

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return withStatus(
        candidate.message.trim(),
        candidate.status ?? candidate.statusCode,
      );
    }
  }

  return String(error);
};

const withStatus = (message: string, status?: unknown): string =>
  typeof status === 'number' ? `${status}: ${message}` : message;

/**
 * Whether an error means "this model does not exist / is no longer served",
 * as opposed to a transport blip, rate limit or auth problem.
 *
 * The monthly liveness probe (ADR Phase 4b) must only flag a model on an
 * authoritative answer — a 429 or a socket reset says nothing about whether the
 * model still exists, and flagging on those would mark everything unavailable
 * during a transient outage.
 */
export const isModelNotFoundError = (error: unknown): boolean => {
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  const message = describeProviderError(error).toLowerCase();

  // 404 is authoritative. 400 is only authoritative when the message names the
  // model as the problem — a 400 can equally mean a malformed request.
  if (status === 404) return true;
  if (status !== 400) return false;

  return (
    message.includes('model') &&
    (message.includes('does not exist') ||
      message.includes('not found') ||
      message.includes('deprecated') ||
      message.includes('decommissioned') ||
      message.includes('no longer available') ||
      message.includes('unsupported model'))
  );
};
