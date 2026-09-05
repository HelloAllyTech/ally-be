import {
  AgentProviderFailure,
  classifyAgentProviderError,
  describeAgentProviderError,
} from '../agent-provider-error.util';

/**
 * Classification of thrown provider errors.
 *
 * The fixtures are the shapes the three SDKs actually throw, not invented
 * ones — the point of the classifier is that those shapes disagree, so a test
 * built on a tidied-up version of them would prove nothing.
 */
describe('classifyAgentProviderError', () => {
  /** Anthropic's APIError: status on the exception, payload inside `error`. */
  const anthropicError = (
    status: number,
    type: string,
    message: string,
  ): Error => {
    const error: any = new Error(
      `${status} ${JSON.stringify({ type: 'error', error: { type, message } })}`,
    );
    error.status = status;
    error.error = { type: 'error', error: { type, message } };
    return error;
  };

  /**
   * OpenAI's APIError: status, a flat `code`, and a `type` that is the code
   * again for a quota failure but `invalid_request_error` for most others.
   */
  const openAiError = (
    status: number,
    code: string,
    message: string,
    type = 'invalid_request_error',
  ) => {
    const error: any = new Error(`${status} ${message}`);
    error.status = status;
    error.code = code;
    error.error = { message, type, code };
    return error;
  };

  it('reads an exhausted Anthropic balance as quota, not a bad request', () => {
    // The failure that prompted all of this: a 400 whose status says
    // "malformed" and whose body says "out of credit".
    const error = anthropicError(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go ' +
        'to Plans & Billing to upgrade or purchase credits.',
    );

    expect(classifyAgentProviderError(error)).toBe(AgentProviderFailure.QUOTA);
  });

  it('reads an exhausted OpenAI quota as quota, not a rate limit', () => {
    // The mirror case: a 429 that will never succeed on retry.
    const error = openAiError(
      429,
      'insufficient_quota',
      'You exceeded your current quota, please check your plan and billing details.',
      'insufficient_quota',
    );

    expect(classifyAgentProviderError(error)).toBe(AgentProviderFailure.QUOTA);
  });

  it('separates a real rate limit from an exhausted quota', () => {
    const error = anthropicError(
      429,
      'rate_limit_error',
      'Number of request tokens has exceeded your per-minute rate limit.',
    );

    expect(classifyAgentProviderError(error)).toBe(
      AgentProviderFailure.RATE_LIMIT,
    );
  });

  it('classifies a bad or missing key as auth', () => {
    expect(
      classifyAgentProviderError(
        anthropicError(401, 'authentication_error', 'invalid x-api-key'),
      ),
    ).toBe(AgentProviderFailure.AUTH);
    expect(
      classifyAgentProviderError(
        openAiError(401, 'invalid_api_key', 'Incorrect API key provided.'),
      ),
    ).toBe(AgentProviderFailure.AUTH);
  });

  it('classifies an overloaded or unreachable provider as unavailable', () => {
    expect(
      classifyAgentProviderError(
        anthropicError(529, 'overloaded_error', 'Overloaded'),
      ),
    ).toBe(AgentProviderFailure.UNAVAILABLE);

    // A transport failure has no status at all — only a `code` on the cause.
    const transport: any = new Error('fetch failed');
    transport.cause = { code: 'ECONNRESET' };
    expect(classifyAgentProviderError(transport)).toBe(
      AgentProviderFailure.UNAVAILABLE,
    );
  });

  it('classifies an oversized request as request_too_large', () => {
    expect(
      classifyAgentProviderError(
        anthropicError(
          400,
          'invalid_request_error',
          'prompt is too long: 251234 tokens > 200000 maximum',
        ),
      ),
    ).toBe(AgentProviderFailure.REQUEST_TOO_LARGE);
  });

  it('reads a Gemini string status off the error', () => {
    const error: any = new Error('got status: RESOURCE_EXHAUSTED');
    error.status = 'RESOURCE_EXHAUSTED';
    expect(classifyAgentProviderError(error)).toBe(
      AgentProviderFailure.RATE_LIMIT,
    );
  });

  it('reports anything unrecognised as unknown rather than guessing', () => {
    expect(classifyAgentProviderError(new Error('boom'))).toBe(
      AgentProviderFailure.UNKNOWN,
    );
    expect(classifyAgentProviderError(undefined)).toBe(
      AgentProviderFailure.UNKNOWN,
    );
  });
});

describe('describeAgentProviderError', () => {
  it('keeps the vendor text and its labels for the log', () => {
    const error: any = new Error('400 credit balance is too low');
    error.status = 400;
    error.error = { type: 'invalid_request_error' };

    const described = describeAgentProviderError(error);

    expect(described).toContain('status=400');
    expect(described).toContain('invalid_request_error');
    expect(described).toContain('credit balance is too low');
  });

  it('truncates a runaway message rather than filling the log with it', () => {
    const described = describeAgentProviderError(new Error('x'.repeat(2000)));

    expect(described.length).toBeLessThan(700);
    expect(described.endsWith('…')).toBe(true);
  });
});
