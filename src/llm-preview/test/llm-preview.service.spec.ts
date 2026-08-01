import { NotFoundException } from '@nestjs/common';
import { LlmPreviewService, PREVIEW_TIMEOUT_MS } from '../llm-preview.service';

const buildService = (config: any, complete = jest.fn()) => {
  const llmConfigService = {
    getConfigById: jest.fn().mockResolvedValue(config),
  };
  const providerFactory = {
    createProvider: jest.fn().mockReturnValue({ complete }),
  };
  const service = new LlmPreviewService(
    llmConfigService as any,
    providerFactory as any,
  );
  return { service, llmConfigService, providerFactory, complete };
};

describe('LlmPreviewService', () => {
  it('404s on a config that does not exist', async () => {
    const { service } = buildService(null);
    await expect(service.previewConfig('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('passes provider, model and temperature from the stored config', async () => {
    const { service, providerFactory, complete } = buildService(
      {
        id: 'c1',
        name: 'OpenAI — gpt-4o-mini',
        provider: 'openai',
        config: { model: 'gpt-4o-mini', temperature: 0.4 },
      },
      jest.fn().mockResolvedValue({ ok: true, text: 'ok', latencyMs: 12 }),
    );

    await service.previewConfig('c1');

    expect(providerFactory.createProvider).toHaveBeenCalledWith(
      'openai',
      'gpt-4o-mini',
      0.4,
    );
    expect(complete).toHaveBeenCalledWith(
      expect.any(String),
      PREVIEW_TIMEOUT_MS,
    );
  });

  it('omits a non-numeric temperature instead of forwarding it', async () => {
    const { service, providerFactory } = buildService(
      {
        name: 'x',
        provider: 'openai',
        config: { model: 'gpt-4o-mini', temperature: 'warm' },
      },
      jest.fn().mockResolvedValue({ ok: true, text: 'ok', latencyMs: 1 }),
    );

    await service.previewConfig('c1');

    expect(providerFactory.createProvider).toHaveBeenCalledWith(
      'openai',
      'gpt-4o-mini',
      undefined,
    );
  });

  // The reason this endpoint exists: a model that stopped working must come
  // back as a readable answer, not a 500 the UI renders as "failed".
  it('returns a provider rejection as data, with the config identified', async () => {
    const { service } = buildService(
      {
        name: 'OpenAI — gpt-4o-mini',
        provider: 'openai',
        config: { model: 'gpt-4o-mini' },
      },
      jest.fn().mockResolvedValue({
        ok: false,
        text: '',
        latencyMs: 40,
        error: '404: The model `gpt-4o-mini` has been deprecated',
      }),
    );

    const result = await service.previewConfig('c1');

    expect(result).toMatchObject({
      ok: false,
      error: '404: The model `gpt-4o-mini` has been deprecated',
      configName: 'OpenAI — gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
  });

  it('reports success with latency and token usage', async () => {
    const { service } = buildService(
      { name: 'n', provider: 'google', config: { model: 'gemini-2.5-flash' } },
      jest.fn().mockResolvedValue({
        ok: true,
        text: 'ok',
        latencyMs: 310,
        promptTokens: 8,
        completionTokens: 2,
      }),
    );

    await expect(service.previewConfig('c1')).resolves.toMatchObject({
      ok: true,
      text: 'ok',
      latencyMs: 310,
      promptTokens: 8,
      completionTokens: 2,
      model: 'gemini-2.5-flash',
    });
  });
});
