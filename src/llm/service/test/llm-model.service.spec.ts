import {
  getLlmModels,
  LlmRuntime,
} from '../../constants/llm-model-registry.constants';
import { LlmModelService } from '../llm-model.service';

const row = (overrides: Partial<Record<string, any>> = {}) => ({
  provider: 'openai',
  model: 'gpt-4o-mini',
  label: 'GPT-4o mini',
  supportsTemperature: true,
  active: true,
  ...overrides,
});

const buildService = (listModels: jest.Mock) =>
  new LlmModelService({ listModels } as any);

describe('LlmModelService', () => {
  it('serves the catalog rows when the table has them', async () => {
    const service = buildService(jest.fn().mockResolvedValue([row()]));

    await expect(service.getModels()).resolves.toEqual([
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        supportsTemperature: true,
        runtimes: [LlmRuntime.AI_LEARN, LlmRuntime.ALLY_AI, LlmRuntime.ALLY_BE],
      },
    ]);
  });

  it('joins runtimes from the in-code matrix, not from the row', async () => {
    // Anthropic is ally-be-only because ai-learn has no Anthropic branch. A DB
    // row cannot widen that, which is the whole point of keeping it in code.
    const service = buildService(
      jest.fn().mockResolvedValue([
        row({
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          runtimes: 'anything',
        }),
      ]),
    );

    const [model] = await service.getModels();

    expect(model.runtimes).toEqual([LlmRuntime.ALLY_BE]);
  });

  it('filters to a requested runtime', async () => {
    const service = buildService(
      jest
        .fn()
        .mockResolvedValue([
          row(),
          row({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
        ]),
    );

    const models = await service.getModels(LlmRuntime.AI_LEARN);

    expect(models.map((m) => m.model)).toEqual(['gpt-4o-mini']);
  });

  // A provider with no code branch would silently build the wrong client at
  // runtime, so it must never reach a picker.
  it('drops a row whose provider no runtime can execute', async () => {
    const service = buildService(
      jest
        .fn()
        .mockResolvedValue([row({ provider: 'cohere', model: 'command-r' })]),
    );

    await expect(service.getModels()).resolves.toEqual([]);
  });

  // Both fallbacks exist so one bad migration or a DB blip cannot blank every
  // model picker in the product.
  it('falls back to the in-code list when the table is empty', async () => {
    const service = buildService(jest.fn().mockResolvedValue([]));

    await expect(service.getModels()).resolves.toEqual(getLlmModels());
  });

  it('falls back to the in-code list when the read fails', async () => {
    const service = buildService(
      jest.fn().mockRejectedValue(new Error('connection terminated')),
    );

    await expect(service.getModels()).resolves.toEqual(getLlmModels());
  });

  it('still honours the runtime filter while falling back', async () => {
    const service = buildService(
      jest.fn().mockRejectedValue(new Error('down')),
    );

    const models = await service.getModels(LlmRuntime.AI_LEARN);

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.runtimes.includes(LlmRuntime.AI_LEARN))).toBe(
      true,
    );
    expect(models.some((m) => m.provider === 'anthropic')).toBe(false);
  });

  it('asks the repository for active rows only', async () => {
    const listModels = jest.fn().mockResolvedValue([row()]);
    await buildService(listModels).getModels();

    expect(listModels).toHaveBeenCalledWith(true);
  });
});
