const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

import { GoogleGenAI } from '@google/genai';
import { GeminiLlmProvider } from '../gemini-llm.provider';
import { LlmMessage } from '../../interface/llm-provider.interface';

const makeProvider = (apiKey?: string) =>
  new GeminiLlmProvider({ gemini: { apiKey } } as any);

const MESSAGES: LlmMessage[] = [
  { role: 'system', content: 'You are a coach.' },
  { role: 'user', content: 'Hi' },
  { role: 'assistant', content: 'Hello!' },
  { role: 'user', content: 'How did I do?' },
];

describe('GeminiLlmProvider', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
    (GoogleGenAI as unknown as jest.Mock).mockClear();
  });

  it('folds system messages into systemInstruction and maps assistant->model', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const provider = makeProvider('key');

    const out = await provider.getCompletion(MESSAGES, {
      model: 'gemini-2.5-flash',
      temperature: 0.5,
      maxTokens: 800,
    });

    expect(out).toBe('ok');
    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.model).toBe('gemini-2.5-flash');
    expect(arg.config.systemInstruction).toBe('You are a coach.');
    expect(arg.config.temperature).toBe(0.5);
    expect(arg.config.maxOutputTokens).toBe(800);
    expect(arg.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello!' }] },
      { role: 'user', parts: [{ text: 'How did I do?' }] },
    ]);
  });

  it('omits temperature for Gemini 3+, which deprecated custom sampling', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const provider = makeProvider('key');

    await provider.getCompletion(MESSAGES, {
      model: 'gemini-3-pro-preview',
      temperature: 0.5,
    });

    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.config).not.toHaveProperty('temperature');
  });

  it('asks for application/json only when responseFormat is json', async () => {
    mockGenerateContent.mockResolvedValue({ text: '{}' });
    const provider = makeProvider('key');

    await provider.getCompletion(MESSAGES, {
      model: 'gemini-2.5-flash',
      responseFormat: 'json',
    });
    await provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' });

    expect(mockGenerateContent.mock.calls[0][0].config.responseMimeType).toBe(
      'application/json',
    );
    expect(mockGenerateContent.mock.calls[1][0].config).not.toHaveProperty(
      'responseMimeType',
    );
  });

  it('sends a thinking budget only when one is set', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const provider = makeProvider('key');

    await provider.getCompletion(MESSAGES, {
      model: 'gemini-2.5-flash',
      thinkingBudget: 0,
    });
    await provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' });

    expect(mockGenerateContent.mock.calls[0][0].config.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
    expect(mockGenerateContent.mock.calls[1][0].config).not.toHaveProperty(
      'thinkingConfig',
    );
  });

  it('omits thinkingBudget for Gemini 3+, which deprecated it', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const provider = makeProvider('key');

    await provider.getCompletion(MESSAGES, {
      model: 'gemini-3.5-pro',
      thinkingBudget: 100,
    });

    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.config).not.toHaveProperty('thinkingConfig');
  });

  it('streams text chunks, skipping empty ones', async () => {
    mockGenerateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'Hel' };
        yield { text: '' };
        yield { text: 'lo' };
      })(),
    );
    const provider = makeProvider('key');

    const chunks: string[] = [];
    for await (const c of provider.streamCompletion(MESSAGES, {
      model: 'gemini-2.5-flash',
    })) {
      chunks.push(c.content);
    }

    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('throws a clear error when no API key is configured', async () => {
    const provider = makeProvider(undefined);
    await expect(
      provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' }),
    ).rejects.toThrow(/GEMINI_API_KEY is not configured/);
  });

  it('builds the client lazily and only once', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'a' });
    const provider = makeProvider('key');
    expect(GoogleGenAI).not.toHaveBeenCalled();
    await provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' });
    await provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' });
    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
  });
});

describe('GeminiLlmProvider with a system-only prompt', () => {
  // The real SDK rejects a call with no `contents` ("contents are required").
  // A system message is moved into `systemInstruction`, so a prompt made only
  // of system messages (the keyed course-translation call) used to leave
  // `contents` empty and failed every field.
  const SDK_CONTENTS_RULE = (arg: { contents?: unknown[] }) => {
    if (!arg.contents || arg.contents.length === 0) {
      throw new Error('contents are required');
    }
  };
  const SYSTEM_ONLY: LlmMessage[] = [
    { role: 'system', content: 'Translate these fields to Hindi.' },
    { role: 'system', content: 'Return JSON.' },
  ];

  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  it('sends the system text as the single user turn so contents is never empty', async () => {
    mockGenerateContent.mockImplementation(async (arg) => {
      SDK_CONTENTS_RULE(arg);
      return { text: '{}' };
    });
    const provider = makeProvider('key');

    await expect(
      provider.getCompletion(SYSTEM_ONLY, {
        model: 'gemini-2.5-flash',
        responseFormat: 'json',
      }),
    ).resolves.toBe('{}');

    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Translate these fields to Hindi.\n\nReturn JSON.' }],
      },
    ]);
    // Not sent twice: the text is the prompt, not also an instruction.
    expect(arg.config.systemInstruction).toBeUndefined();
  });

  it('does the same for a streamed call', async () => {
    mockGenerateContentStream.mockImplementation(async (arg) => {
      SDK_CONTENTS_RULE(arg);
      return (async function* () {
        yield { text: 'hi' };
      })();
    });
    const provider = makeProvider('key');

    const chunks: string[] = [];
    for await (const c of provider.streamCompletion(SYSTEM_ONLY, {
      model: 'gemini-2.5-flash',
    })) {
      chunks.push(c.content);
    }

    expect(chunks).toContain('hi');
    expect(mockGenerateContentStream.mock.calls[0][0].contents).toHaveLength(1);
  });

  it('still keeps system text out of the turns when there is a real conversation', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const provider = makeProvider('key');

    await provider.getCompletion(MESSAGES, { model: 'gemini-2.5-flash' });

    const arg = mockGenerateContent.mock.calls[0][0];
    expect(arg.config.systemInstruction).toBe('You are a coach.');
    expect(arg.contents).toHaveLength(3);
  });
});

describe('GeminiLlmProvider usage', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  it('reports only the LAST cumulative usage block of a stream, with thinking as output', async () => {
    mockGenerateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'a', usageMetadata: { promptTokenCount: 50 } };
        yield {
          text: 'b',
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 7,
            thoughtsTokenCount: 3,
          },
        };
      })(),
    );
    const provider = makeProvider('key');

    const out: any[] = [];
    for await (const c of provider.streamCompletion(MESSAGES, {
      model: 'gemini-2.5-flash',
    })) {
      out.push(c);
    }

    const usages = out.filter((c) => c.usage);
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      cachedTokens: undefined,
    });
  });

  it('passes a non-streamed call’s usage to onUsage', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'ok',
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 },
    });
    const onUsage = jest.fn();

    await makeProvider('key').getCompletion(
      MESSAGES,
      { model: 'gemini-2.5-flash' },
      onUsage,
    );

    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 9, completionTokens: 2 }),
    );
  });
});
