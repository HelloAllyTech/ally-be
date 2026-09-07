import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LlmPreviewService, PREVIEW_TIMEOUT_MS } from '../llm-preview.service';

/**
 * `complete` here is LlmCompletionService's, not a per-provider client's.
 *
 * The preview's three SDK adapters were folded into the shared `llm-agent`
 * ones, so what this service now owns is the CONTRACT around that call:
 * misconfiguration raises, a vendor rejection comes back as data, and the
 * target is never re-resolved. The fake resolves the shared shape
 * (`{text, provider, model, source, usage}`) and rejects to simulate a
 * provider saying no — which is what `complete` does for real.
 */
const buildService = (
  config: any,
  complete = jest.fn(),
  catalog: any[] = [],
  isConfigured = true,
) => {
  const llmConfigService = {
    getConfigById: jest.fn().mockResolvedValue(config),
  };
  const llmModelService = {
    getCatalog: jest.fn().mockResolvedValue(catalog),
  };
  const agentFactory = {
    isConfigured: jest.fn().mockReturnValue(isConfigured),
  };
  const service = new LlmPreviewService(
    llmConfigService as any,
    llmModelService as any,
    { complete } as any,
    agentFactory as any,
  );
  return {
    service,
    llmConfigService,
    llmModelService,
    agentFactory,
    complete,
  };
};

/** The shared completion shape, for a call that succeeded. */
const completed = (text = 'ok', inputTokens = 0, outputTokens = 0) => ({
  text,
  provider: 'openai',
  model: 'gpt-4o-mini',
  source: 'request',
  usage: { inputTokens, outputTokens },
});

describe('LlmPreviewService', () => {
  it('404s on a config that does not exist', async () => {
    const { service } = buildService(null);
    await expect(service.previewConfig('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('passes provider, model and temperature from the stored config', async () => {
    const { service, complete } = buildService(
      {
        id: 'c1',
        name: 'OpenAI — gpt-4o-mini',
        provider: 'openai',
        config: { model: 'gpt-4o-mini', temperature: 0.4 },
      },
      jest.fn().mockResolvedValue(completed()),
    );

    await service.previewConfig('c1');

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.4,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      }),
    );
  });

  it('names the model explicitly so the chain cannot substitute one', async () => {
    // The whole point of a preview is testing THIS model. An explicit model
    // wins the resolution chain outright, and the registry row carries
    // neverFallback so a failure cannot be answered by the tier default.
    const { service, complete } = buildService(
      {
        name: 'n',
        provider: 'anthropic',
        config: { model: 'claude-haiku-4-5' },
      },
      jest.fn().mockResolvedValue(completed()),
    );

    await service.previewConfig('c1');

    expect(complete.mock.calls[0][0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      taskId: 'llm-preview',
    });
  });

  it('raises rather than reporting ok:false when a key is missing here', async () => {
    // Our misconfiguration, not the model's. Reporting it as data would read
    // as "this model is broken" on a blank environment.
    const { service, complete } = buildService(
      { name: 'n', provider: 'openai', config: { model: 'gpt-4o-mini' } },
      jest.fn(),
      [],
      false,
    );

    await expect(service.previewConfig('c1')).rejects.toThrow(
      BadRequestException,
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('raises for a provider that runs inside the voice runtime', async () => {
    const { service, complete } = buildService(
      { name: 'n', provider: 'ollama', config: { model: 'llama3' } },
      jest.fn(),
    );

    await expect(service.previewConfig('c1')).rejects.toThrow(
      /cannot be previewed from here/,
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('omits a non-numeric temperature instead of forwarding it', async () => {
    const { service, complete } = buildService(
      {
        name: 'x',
        provider: 'openai',
        config: { model: 'gpt-4o-mini', temperature: 'warm' },
      },
      jest.fn().mockResolvedValue(completed()),
    );

    await service.previewConfig('c1');

    expect(complete.mock.calls[0][0].temperature).toBeUndefined();
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
      // `complete` THROWS on a provider rejection; turning that into data is
      // this service's job and the reason the endpoint exists.
      jest.fn().mockRejectedValue({
        status: 404,
        error: { message: 'The model `gpt-4o-mini` has been deprecated' },
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
      jest.fn().mockResolvedValue(completed('ok', 8, 2)),
    );

    const result = await service.previewConfig('c1');

    expect(result).toMatchObject({
      ok: true,
      text: 'ok',
      promptTokens: 8,
      completionTokens: 2,
      model: 'gemini-2.5-flash',
    });
    // Measured around the call rather than reported by it.
    expect(typeof result.latencyMs).toBe('number');
  });
});

describe('LlmPreviewService — catalog model', () => {
  const row = {
    id: 'm1',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
  };

  it('404s on a model that is not in the catalog', async () => {
    const { service } = buildService(null, jest.fn(), []);
    await expect(service.previewModel('nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('tests the catalog row and reports under its display name', async () => {
    const { service, complete } = buildService(
      null,
      jest.fn().mockResolvedValue(completed()),
      [row],
    );

    await expect(service.previewModel('m1')).resolves.toMatchObject({
      ok: true,
      configName: 'Gemini 2.5 Flash',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    // A catalog row carries no temperature — that is a per-prompt concern.
    expect(complete.mock.calls[0][0].temperature).toBeUndefined();
  });

  it('returns a provider rejection as data, not an exception', async () => {
    const { service } = buildService(
      null,
      jest.fn().mockRejectedValue({ status: 404, message: 'model not found' }),
      [row],
    );

    await expect(service.previewModel('m1')).resolves.toMatchObject({
      ok: false,
      error: '404: model not found',
    });
  });
});
