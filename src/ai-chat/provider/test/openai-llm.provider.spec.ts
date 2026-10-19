const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { OpenAiLlmProvider } from '../openai-llm.provider';

const makeProvider = () =>
  new OpenAiLlmProvider({ openai: { apiKey: 'key' } } as any);

describe('OpenAiLlmProvider', () => {
  beforeEach(() => mockCreate.mockReset());

  it('uses JSON mode only when responseFormat is json', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    const provider = makeProvider();
    const messages = [{ role: 'user' as const, content: 'hi' }];

    await provider.getCompletion(messages, {
      model: 'gpt-4o-mini',
      responseFormat: 'json',
    });
    await provider.getCompletion(messages, { model: 'gpt-4o-mini' });

    expect(mockCreate.mock.calls[0][0].response_format).toEqual({
      type: 'json_object',
    });
    expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('response_format');
  });
});
