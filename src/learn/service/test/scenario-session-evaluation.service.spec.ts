import { ScenarioSessionEvaluationService } from '../scenario-session-evaluation.service';
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
