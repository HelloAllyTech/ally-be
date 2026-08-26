import { ScenarioSessionEvaluationWebhookController } from '../scenario-session-evaluation-webhook.controller';

describe('ScenarioSessionEvaluationWebhookController — endV2VSession', () => {
  const make = () => {
    const evaluationService = {
      applyResult: jest.fn().mockResolvedValue(undefined),
      scheduleV2VEvaluation: jest.fn(),
    };
    const scenarioSessionService = {
      recordV2VMetrics: jest.fn().mockResolvedValue(undefined),
      endScenarioSession: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ScenarioSessionEvaluationWebhookController(
      evaluationService as any,
      scenarioSessionService as any,
    );
    return { controller, evaluationService, scenarioSessionService };
  };

  /**
   * The whole point of the fast path: a V2V run always loses the normal
   * end-of-session trigger, so without this the score arrives 15-45 minutes
   * later via the catch-up sweep — long enough to make a paired A/B unrunnable
   * in one sitting.
   */
  it('schedules the actor evaluation so the run is not left to the catch-up', async () => {
    const { controller, evaluationService } = make();

    await controller.endV2VSession('sess-1', { counselorId: 7 } as any);

    expect(evaluationService.scheduleV2VEvaluation).toHaveBeenCalledWith(
      'sess-1',
    );
  });

  it('ends the session BEFORE scheduling — the judge reads a finished transcript', async () => {
    const { controller, evaluationService, scenarioSessionService } = make();
    const order: string[] = [];
    scenarioSessionService.endScenarioSession.mockImplementation(async () => {
      order.push('end');
    });
    evaluationService.scheduleV2VEvaluation.mockImplementation(() => {
      order.push('schedule');
    });

    await controller.endV2VSession('sess-1', { counselorId: 7 } as any);

    expect(order).toEqual(['end', 'schedule']);
  });

  it('records tester metrics when supplied, and skips the write when not', async () => {
    const withMetrics = make();
    await withMetrics.controller.endV2VSession('sess-1', {
      counselorId: 7,
      metrics: { exchangesCompleted: 8 },
    } as any);
    expect(
      withMetrics.scenarioSessionService.recordV2VMetrics,
    ).toHaveBeenCalledWith('sess-1', { exchangesCompleted: 8 });

    const without = make();
    await without.controller.endV2VSession('sess-1', {
      counselorId: 7,
    } as any);
    expect(
      without.scenarioSessionService.recordV2VMetrics,
    ).not.toHaveBeenCalled();
  });
});
