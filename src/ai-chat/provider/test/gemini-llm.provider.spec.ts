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
