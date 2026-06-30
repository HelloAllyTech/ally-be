import { Test, TestingModule } from '@nestjs/testing';
import { TurnMetricsProcessor } from '../turn-metrics.processor';
import { ScenarioSessionService } from '../../service/scenario-session.service';
import { LoggerService } from '../../../logger/logger.service';
import { LearnMessageAndEventMessage } from '../../interface/learn-message.interface';

describe('TurnMetricsProcessor', () => {
  let processor: TurnMetricsProcessor;
  let scenarioSessionService: {
    getScenarioSessionByRoomIdOrNull: jest.Mock;
    addTurnMetrics: jest.Mock;
  };

  const turnMetrics = {
    turn_index: 2,
    invocation_id: 'abc12345',
    response_latency_ms: 1320,
    llm_response_ms: 700,
    tts_ttfb_ms: 260,
    scenario_id: 99,
    response_chars: 120,
    events_detected: 1,
  };

  const message = (overrides: Partial<LearnMessageAndEventMessage> = {}) =>
    ({
      message_type: 'turn_metrics',
      room_id: 'room-123',
      timestamp: 1_700_000_000,
      data: { turn_metrics: turnMetrics },
      ...overrides,
    }) as LearnMessageAndEventMessage;

  beforeEach(async () => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);

    scenarioSessionService = {
      getScenarioSessionByRoomIdOrNull: jest.fn(),
      addTurnMetrics: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TurnMetricsProcessor,
        { provide: ScenarioSessionService, useValue: scenarioSessionService },
      ],
    }).compile();

    processor = module.get<TurnMetricsProcessor>(TurnMetricsProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  it('registers under the turn_metrics event type', () => {
    expect(processor.getEventType()).toBe('turn_metrics');
  });

  it('persists metrics with the agent timestamp when the session exists', async () => {
    const session = { id: 'sess-1', tenantId: 't1', roomId: 'room-123' };
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      session,
    );

    await processor.process(message());

    expect(scenarioSessionService.addTurnMetrics).toHaveBeenCalledTimes(1);
    const [passedSession, passedMetrics, occurredAt] =
      scenarioSessionService.addTurnMetrics.mock.calls[0];
    expect(passedSession).toBe(session);
    expect(passedMetrics).toBe(turnMetrics);
    expect(occurredAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('skips preview rooms without touching the DB', async () => {
    await processor.process(message({ room_id: 'preview-xyz' }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(scenarioSessionService.addTurnMetrics).not.toHaveBeenCalled();
  });

  it('no-ops when the scenario session is not found', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue(
      null,
    );

    await processor.process(message());

    expect(scenarioSessionService.addTurnMetrics).not.toHaveBeenCalled();
  });

  it('no-ops when the turn_metrics payload is missing', async () => {
    await processor.process(message({ data: {} as any }));

    expect(
      scenarioSessionService.getScenarioSessionByRoomIdOrNull,
    ).not.toHaveBeenCalled();
    expect(scenarioSessionService.addTurnMetrics).not.toHaveBeenCalled();
  });

  it('rethrows when persistence fails (so the SQS message is retried)', async () => {
    scenarioSessionService.getScenarioSessionByRoomIdOrNull.mockResolvedValue({
      id: 'sess-1',
      tenantId: 't1',
      roomId: 'room-123',
    });
    scenarioSessionService.addTurnMetrics.mockRejectedValue(
      new Error('db down'),
    );

    await expect(processor.process(message())).rejects.toThrow('db down');
  });
});
