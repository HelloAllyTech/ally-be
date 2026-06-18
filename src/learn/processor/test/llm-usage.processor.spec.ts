import { Test, TestingModule } from '@nestjs/testing';
import { LlmUsageProcessor } from '../llm-usage.processor';
import { LlmUsageService } from '../../../analytics/service/llm-usage.service';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from '../../../logger/logger.service';
import { LlmUsageMessage } from '../../interface/learn-message.interface';

describe('LlmUsageProcessor', () => {
  let processor: LlmUsageProcessor;
  let llmUsageService: { record: jest.Mock };
  let scenarioSessionService: { getScenarioSessionByRoomIdOrNull: jest.Mock };

  const usage = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    task: 'summary',
    prompt_tokens: 100,
    completion_tokens: 40,
    total_tokens: 140,
  };

  const message = (overrides: Partial<LlmUsageMessage> = {}): LlmUsageMessage =>
    ({
      message_type: 'llm_usage',
      timestamp: 1_700_000_000,
      data: { llm_usage: usage },
      ...overrides,
    }) as LlmUsageMessage;

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);

    llmUsageService = { record: jest.fn().mockResolvedValue(undefined) };
    scenarioSessionService = {
      getScenarioSessionByRoomIdOrNull: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmUsageProcessor,
        { provide: LlmUsageService, useValue: llmUsageService },
        { provide: ScenarioSessionService, useValue: scenarioSessionService },
      ],
    }).compile();

    processor = module.get<LlmUsageProcessor>(LlmUsageProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('registers under the llm_usage event type', () => {
    expect(processor.getEventType()).toBe('llm_usage');
  });

  it('persists usage with mapped tokens and the agent timestamp (no room)', async () => {
    await processor.process(message());

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(llmUsageService.record).toHaveBeenCalledTimes(1);
    const arg = llmUsageService.record.mock.calls[0][0];
    expect(arg).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      task: 'summary',
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
    });
    expect(arg.occurredAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('enriches scenarioSessionId/tenantId when a room resolves to a session', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue({
      id: 'sess-1',
      tenantId: 't1',
    });

    await processor.process(message({ room_id: 'room-123' }));

    const arg = llmUsageService.record.mock.calls[0][0];
    expect(arg.scenarioSessionId).toBe('sess-1');
    expect(arg.tenantId).toBe('t1');
    expect(arg.roomId).toBe('room-123');
  });

  it('persists even when the room has no session (still records)', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      null,
    );

    await processor.process(message({ room_id: 'room-orphan' }));

    expect(llmUsageService.record).toHaveBeenCalledTimes(1);
    expect(llmUsageService.record.mock.calls[0][0].roomId).toBe('room-orphan');
  });

  it('does not resolve a session for preview rooms but still records', async () => {
    await processor.process(message({ room_id: 'preview-abc' }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(llmUsageService.record).toHaveBeenCalledTimes(1);
  });

  it('no-ops when model/task are missing', async () => {
    await processor.process(
      message({ data: { llm_usage: { provider: 'openai' } as any } }),
    );

    expect(llmUsageService.record).not.toHaveBeenCalled();
  });

  it('does not rethrow (record is best-effort)', async () => {
    llmUsageService.record.mockResolvedValue(undefined);
    await expect(processor.process(message())).resolves.toBeUndefined();
  });
});
