import { RoleplayCoachingService } from '../roleplay-coaching.service';
import { ScenarioEngine } from '../../enum/scenario-engine.enum';
import { RoleplayDirectorEventType } from '../../../roleplay-studio/enum/director-event-type.enum';

describe('RoleplayCoachingService', () => {
  const buildDeps = (over: {
    session?: any;
    rubricRows?: any[];
    eventRows?: any[];
    specVersion?: any;
    isAdmin?: boolean;
  }) => {
    const scenarioSessionRepository = {
      getScenarioSession: jest.fn().mockResolvedValue(over.session ?? null),
    } as any;
    const permissionValidator = {
      validatePermissions: jest.fn().mockResolvedValue(over.isAdmin ?? false),
    } as any;
    const dataSource = {
      getRepository: (entity: any) => ({
        find: jest
          .fn()
          .mockResolvedValue(
            entity?.name === 'RoleplayRubricScore'
              ? (over.rubricRows ?? [])
              : (over.eventRows ?? []),
          ),
        findOne: jest.fn().mockResolvedValue(over.specVersion ?? null),
      }),
      query: jest.fn().mockResolvedValue([{ roleplaySpecVersionId: 'ver-1' }]),
    } as any;
    return { scenarioSessionRepository, permissionValidator, dataSource };
  };

  it('returns available=false for a non-v2 session', async () => {
    const deps = buildDeps({
      session: { scenario: { engine: ScenarioEngine.SIMULATION } },
    });
    const svc = new RoleplayCoachingService(
      deps.scenarioSessionRepository,
      deps.permissionValidator,
      deps.dataSource,
    );
    const out = await svc.getLearnerCoaching('s1', 42);
    expect(out.available).toBe(false);
  });

  it('returns available=false when the session is not the caller’s', async () => {
    const deps = buildDeps({ session: null });
    const svc = new RoleplayCoachingService(
      deps.scenarioSessionRepository,
      deps.permissionValidator,
      deps.dataSource,
    );
    const out = await svc.getLearnerCoaching('s1', 42);
    expect(out.available).toBe(false);
    expect(
      deps.scenarioSessionRepository.getScenarioSession,
    ).toHaveBeenCalledWith('s1', 42, false);
  });

  it('builds strengths, growth areas, disclosures and coaching notes for a v2 session', async () => {
    const deps = buildDeps({
      session: {
        scenario: { engine: ScenarioEngine.ROLEPLAY_V2 },
        score: 7,
        metadata: {
          roleplaySummary: {
            finalStateId: 'state-opening',
            statePath: ['state-guarded', 'state-opening'],
            cumulativeScore: 7,
          },
        },
      },
      rubricRows: [
        {
          behaviorId: 'beh-validation',
          score: 2,
          rationale: 'good',
          turnIndex: 1,
        },
        {
          behaviorId: 'beh-validation',
          score: 2,
          rationale: 'again',
          turnIndex: 2,
        },
        {
          behaviorId: 'beh-judgment',
          score: -3,
          rationale: 'harsh',
          turnIndex: 3,
        },
      ],
      eventRows: [
        {
          eventType: RoleplayDirectorEventType.DISCLOSURE_UNLOCK,
          turnIndex: 2,
          payload: {
            secret_id: 'secret-parking',
            disclosed_content_summary: 'garage',
          },
        },
        {
          eventType: RoleplayDirectorEventType.STAGE_DIRECTION,
          turnIndex: 3,
          payload: {
            direction: 'soften',
            trainee_feedback: 'Try reflecting more.',
          },
        },
      ],
      specVersion: {
        spec: {
          rubric: {
            behaviors: [
              { id: 'beh-validation', name: 'Validation', polarity: 'helpful' },
              { id: 'beh-judgment', name: 'Judgment', polarity: 'unhelpful' },
              { id: 'beh-open', name: 'Open questions', polarity: 'helpful' },
            ],
          },
        },
      },
    });
    const svc = new RoleplayCoachingService(
      deps.scenarioSessionRepository,
      deps.permissionValidator,
      deps.dataSource,
    );
    const out = await svc.getLearnerCoaching('s1', 42);

    expect(out.available).toBe(true);
    expect(out.stateJourney).toEqual(['state-guarded', 'state-opening']);
    expect(out.cumulativeScore).toBe(7);

    // Observed helpful behavior → strength (with capped examples).
    const validation = out.strengths.find(
      (b) => b.behaviorId === 'beh-validation',
    );
    expect(validation?.observedCount).toBe(2);
    expect(validation?.totalScore).toBe(4);
    expect(validation?.examples).toEqual(['good', 'again']);

    // Observed unhelpful behavior AND an unshown helpful behavior → growth.
    const growthIds = out.growthAreas.map((b) => b.behaviorId);
    expect(growthIds).toContain('beh-judgment');
    expect(growthIds).toContain('beh-open');

    expect(out.disclosures).toEqual([
      { secretId: 'secret-parking', topic: 'garage', turnIndex: 2 },
    ]);
    expect(out.coachingNotes).toEqual([
      { turnIndex: 3, feedback: 'Try reflecting more.' },
    ]);
  });
});
