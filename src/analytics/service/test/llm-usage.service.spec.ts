import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LlmUsageService } from '../llm-usage.service';
import { LlmUsage } from '../../entity/llm-usage.entity';
import { LlmTask } from '../../../learn/enum/llm-task.enum';
import { LoggerService } from '../../../logger/logger.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';

describe('LlmUsageService', () => {
  let service: LlmUsageService;
  let repo: { insert: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);

    repo = { insert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmUsageService,
        { provide: getRepositoryToken(LlmUsage), useValue: repo },
      ],
    }).compile();

    service = module.get<LlmUsageService>(LlmUsageService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('inserts the mapped usage row', async () => {
    await service.record({
      provider: 'openai',
      model: 'gpt-4o-mini',
      task: LlmTask.AUTOFILL_FIELD,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      tenantId: 't1',
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert.mock.calls[0][0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      task: 'autofill_field',
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      tenantId: 't1',
    });
  });

  it('defaults totalTokens to prompt + completion', async () => {
    await service.record({
      provider: 'openai',
      model: 'gpt-4o',
      task: LlmTask.SUMMARY,
      promptTokens: 30,
      completionTokens: 12,
    });

    expect(repo.insert.mock.calls[0][0].totalTokens).toBe(42);
  });

  it('falls back to ExecutionManager tenant when tenantId omitted', async () => {
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('ctx-tenant');

    await service.record({
      provider: 'openai',
      model: 'gpt-4o',
      task: LlmTask.TRANSLATE_TEXT,
    });

    expect(repo.insert.mock.calls[0][0].tenantId).toBe('ctx-tenant');
  });

  it('no-ops when model/task are missing', async () => {
    await service.record({ provider: 'openai', model: '', task: '' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('swallows repository errors (best-effort, never throws)', async () => {
    repo.insert.mockRejectedValue(new Error('db down'));

    await expect(
      service.record({
        provider: 'openai',
        model: 'gpt-4o',
        task: LlmTask.NUDGE,
      }),
    ).resolves.toBeUndefined();
  });
});
