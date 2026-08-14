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
