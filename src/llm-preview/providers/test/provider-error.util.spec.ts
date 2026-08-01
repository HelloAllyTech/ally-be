import {
  describeProviderError,
  isModelNotFoundError,
} from '../provider-error.util';

describe('describeProviderError', () => {
  it('keeps the provider wording, which is the part that says what to do', () => {
    const error = {
      status: 404,
      error: { message: 'The model `gpt-4o-mini` has been deprecated' },
    };

    expect(describeProviderError(error)).toBe(
      '404: The model `gpt-4o-mini` has been deprecated',
    );
  });

  it('reads the nested OpenAI/Anthropic shape before the outer message', () => {
    const error = {
      message: 'Request failed',
      error: { message: 'model_not_found' },
    };

    expect(describeProviderError(error)).toBe('model_not_found');
  });

  it('falls back to the outer message when there is no nested one', () => {
    expect(describeProviderError(new Error('socket hang up'))).toBe(
      'socket hang up',
    );
  });

  it('handles a thrown string and a null without blowing up', () => {
    expect(describeProviderError('boom')).toBe('boom');
    expect(describeProviderError(null)).toBe('Unknown error');
  });
});

describe('isModelNotFoundError', () => {
  it('treats a 404 as authoritative', () => {
    expect(isModelNotFoundError({ status: 404, message: 'nope' })).toBe(true);
  });

  it('accepts a 400 only when the message blames the model', () => {
    expect(
      isModelNotFoundError({
        status: 400,
        error: { message: 'The model `x` does not exist' },
      }),
    ).toBe(true);
  });

  it('rejects a 400 about something other than the model', () => {
    expect(
      isModelNotFoundError({
        status: 400,
        error: { message: 'temperature must be <= 2' },
      }),
    ).toBe(false);
  });

  // The whole point of the classifier: a monthly probe must not mark every
  // model dead because the provider had a bad ten minutes.
  it.each([
    [429, 'Rate limit reached'],
    [500, 'Internal server error'],
    [503, 'Service unavailable'],
    [401, 'Invalid API key'],
  ])('does not flag a %s (%s) as a missing model', (status, message) => {
    expect(isModelNotFoundError({ status, error: { message } })).toBe(false);
  });

  it('does not flag a transport error with no status', () => {
    expect(isModelNotFoundError(new Error('ECONNRESET'))).toBe(false);
  });
});
