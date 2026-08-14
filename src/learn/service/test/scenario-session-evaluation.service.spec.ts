import {
  ActorEvaluationStatus,
  ScenarioSessionEvaluationService,
} from '../scenario-session-evaluation.service';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';

describe('ScenarioSessionEvaluationService — upsertDetails', () => {
  const session = {
    id: 'sess-1',
    tenantId: 'tenant-1',
  } as unknown as ScenarioSessions;

  const make = () => {
    const detailsRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
    const service = new ScenarioSessionEvaluationService(
      detailsRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, detailsRepo };
  };

  // The previous find-then-create raced the session-end summary writer and
  // produced duplicate scenario_session_details rows (the missing-feedback
  // bug). The write must be a single atomic upsert against the unique
  // scenarioSessionId index, patching only the evaluation columns so an
  // existing summary is never clobbered.
  it('writes via atomic upsert on scenarioSessionId with only patch columns', async () => {
    const { service, detailsRepo } = make();

    await (service as any).upsertDetails(session, {
      evaluationStatus: 'IN_PROGRESS',
    });

    expect(detailsRepo.upsert).toHaveBeenCalledTimes(1);
    const [values, options] = detailsRepo.upsert.mock.calls[0];
    expect(values).toEqual({
      scenarioSessionId: 'sess-1',
      tenantId: 'tenant-1',
      evaluationStatus: 'IN_PROGRESS',
    });
    expect(values).not.toHaveProperty('summary');
    expect(options).toEqual({ conflictPaths: ['scenarioSessionId'] });
  });
});

describe('ScenarioSessionEvaluationService — triggerForSession idempotency', () => {
  const session = {
    id: 'sess-1',
    tenantId: 'tenant-1',
    counselorId: 7,
  } as unknown as ScenarioSessions;

  const make = (existing: { evaluationStatus?: string } | null) => {
    const detailsRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const messagesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ senderId: 7, content: 'hello', id: 1 }]),
    };
    const testCaseService = {
      getAgentTestCases: jest
        .fn()
        .mockResolvedValue({ data: [{ id: 'g1', title: 'Build rapport' }] }),
    };
    const aiService = {
      triggerActorGoalEvaluation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ScenarioSessionEvaluationService(
      detailsRepo as any,
      messagesRepo as any,
      testCaseService as any,
      aiService as any,
      {} as any,
    );
    return { service, aiService, testCaseService };
  };

  // `end-of-session` arrives over SQS and can be redelivered; without this
  // guard each redelivery re-ran a full-transcript LLM judge on a session that
  // was already scored.
  it.each([ActorEvaluationStatus.IN_PROGRESS, ActorEvaluationStatus.COMPLETED])(
    'skips a session already %s',
    async (evaluationStatus) => {
      const { service, aiService } = make({ evaluationStatus });

      await service.triggerForSession(session);

      expect(aiService.triggerActorGoalEvaluation).not.toHaveBeenCalled();
    },
  );

  // A failed judge run stays retriggerable so a superadmin/backfill can retry.
  it('re-runs a session whose previous evaluation FAILED', async () => {
    const { service, aiService } = make({
      evaluationStatus: ActorEvaluationStatus.FAILED,
    });

    await service.triggerForSession(session);

    expect(aiService.triggerActorGoalEvaluation).toHaveBeenCalledTimes(1);
  });

  it('runs when no details row exists yet', async () => {
    const { service, aiService } = make(null);

    await service.triggerForSession(session);

    expect(aiService.triggerActorGoalEvaluation).toHaveBeenCalledTimes(1);
  });

  // The guard must short-circuit before the goal fetch, so a redelivery costs
  // one indexed read rather than the whole trigger path.
  it('short-circuits before fetching agent test cases', async () => {
    const { service, testCaseService } = make({
      evaluationStatus: ActorEvaluationStatus.COMPLETED,
    });

    await service.triggerForSession(session);

    expect(testCaseService.getAgentTestCases).not.toHaveBeenCalled();
  });
});

describe('ScenarioSessionEvaluationService — runCatchup', () => {
  const makeSessions = (count: number) =>
    Array.from(
      { length: count },
      (_, i) =>
        ({
          id: `sess-${i}`,
          tenantId: 'tenant-1',
          counselorId: 7,
        }) as unknown as ScenarioSessions,
    );

  const make = (
    found: ScenarioSessions[] | Error,
    detailsFindOne: unknown = null,
  ) => {
    const sessionRepo = {
      findSessionsMissingActorEvaluation: jest.fn(() =>
        found instanceof Error ? Promise.reject(found) : Promise.resolve(found),
      ),
    };
    const detailsRepo = {
      findOne: jest.fn().mockResolvedValue(detailsFindOne),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const messagesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ senderId: 7, content: 'hello', id: 1 }]),
    };
    const testCaseService = {
      getAgentTestCases: jest
        .fn()
        .mockResolvedValue({ data: [{ id: 'g1', title: 'Build rapport' }] }),
    };
    const aiService = {
      triggerActorGoalEvaluation: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ScenarioSessionEvaluationService(
      detailsRepo as any,
      messagesRepo as any,
      testCaseService as any,
      aiService as any,
      sessionRepo as any,
    );
    return { service, sessionRepo, aiService };
  };

  it('triggers an evaluation for every session the end-of-session path missed', async () => {
    const { service, aiService } = make(makeSessions(3));

    const result = await service.runCatchup();

    expect(result).toEqual({ found: 3, triggered: 3 });
    expect(aiService.triggerActorGoalEvaluation).toHaveBeenCalledTimes(3);
  });

  // Sessions that ended seconds ago may still have an `end-of-session` message
  // in flight; only genuinely missed ones should be swept.
  it('scans a 24h window ending at a 15-minute grace cutoff, capped at 50', async () => {
    const { service, sessionRepo } = make([]);

    await service.runCatchup();

    const [params] = sessionRepo.findSessionsMissingActorEvaluation.mock
      .calls[0] as unknown as [
      { endedAfter: Date; endedBefore: Date; limit: number },
    ];
    expect(params.limit).toBe(50);
    const graceMs = Date.now() - params.endedBefore.getTime();
    expect(graceMs).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(graceMs).toBeLessThan(16 * 60 * 1000);
    const windowMs = params.endedBefore.getTime() - params.endedAfter.getTime();
    expect(windowMs).toBe(24 * 60 * 60 * 1000 - 15 * 60 * 1000);
  });

  // Runs from the shared scheduler, so a DB hiccup must not take the tick down.
  it('never throws when the scan fails', async () => {
    const { service, aiService } = make(new Error('DB down'));

    await expect(service.runCatchup()).resolves.toEqual({
      found: 0,
      triggered: 0,
    });
    expect(aiService.triggerActorGoalEvaluation).not.toHaveBeenCalled();
  });

  // The trigger re-checks the same guard, so a row that got evaluated between
  // the scan and the trigger is still not double-spent.
  it('does not spend on a session evaluated between scan and trigger', async () => {
    const { service, aiService } = make(makeSessions(2), {
      evaluationStatus: ActorEvaluationStatus.COMPLETED,
    });

    // `triggered` counts real dispatches, so the log/return can't claim work
    // that the trigger's own guard skipped.
    await expect(service.runCatchup()).resolves.toEqual({
      found: 2,
      triggered: 0,
    });
    expect(aiService.triggerActorGoalEvaluation).not.toHaveBeenCalled();
  });
});
