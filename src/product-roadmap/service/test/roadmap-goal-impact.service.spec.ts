import { RoadmapGoalImpactService } from '../roadmap-goal-impact.service';
import { RoadmapAiService } from '../roadmap-ai.service';

const ACTOR = 7;
const OPP = 'opp-1';

/**
 * The assessment path, whose whole job is to be honest about what the model did and did not
 * say. Coverage is a RANKING input, so every ambiguity here has to resolve downwards.
 */
describe('RoadmapGoalImpactService', () => {
  const buildService = (overrides: {
    goals?: { name: string }[];
    assess?: jest.Mock;
    opportunity?: unknown;
  }) => {
    const goals = overrides.goals ?? [{ name: 'Goal A' }, { name: 'Goal B' }];
    const replaceForOpportunity = jest.fn().mockResolvedValue(undefined);
    const goalRepository = {
      findAllOrdered: jest.fn().mockResolvedValue(goals),
    };
    const impactRepository = {
      replaceForOpportunity,
      findForOpportunity: jest.fn().mockResolvedValue([]),
      findNeedingAssessment: jest.fn().mockResolvedValue([]),
      countNeedingAssessment: jest.fn().mockResolvedValue(0),
    };
    const opportunityRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          overrides.opportunity === undefined
            ? { id: OPP, description: 'A draft' }
            : overrides.opportunity,
        ),
    };
    const aiService = {
      assessGoalImpact: overrides.assess ?? jest.fn().mockResolvedValue([]),
    };
    const notifications = { emit: jest.fn() };

    const service = new RoadmapGoalImpactService(
      goalRepository as never,
      impactRepository as never,
      opportunityRepository as never,
      aiService as unknown as RoadmapAiService,
      notifications as never,
    );
    return { service, replaceForOpportunity, aiService, notifications };
  };

  it('does not call the model when no strategy is defined', async () => {
    // Day one is a legitimate state, not an error: the composite already degrades to the other
    // three factors when the goal count is zero, so paying for an assessment against nothing
    // would be pure waste.
    const { service, aiService, replaceForOpportunity } = buildService({
      goals: [],
    });

    await expect(service.assess(OPP, ACTOR)).resolves.toEqual([]);
    expect(aiService.assessGoalImpact).not.toHaveBeenCalled();
    expect(replaceForOpportunity).not.toHaveBeenCalled();
  });

  it('never lets an assessment failure break the write that triggered it', async () => {
    // assessQuietly is called AFTER the row is committed, on file and on description edit. A
    // model outage that failed those requests would take the board's write path down with it.
    const { service } = buildService({
      assess: jest.fn().mockRejectedValue(new Error('anthropic 529')),
    });

    await expect(service.assessQuietly(OPP, ACTOR)).resolves.toBeUndefined();
  });

  it('keeps going when one opportunity in a bulk run fails', async () => {
    // A single unassessable description must not block the other twenty-four — the whole point
    // of the bulk run is catching up a board that a new goal just invalidated.
    const goalRepository = {
      findAllOrdered: jest.fn().mockResolvedValue([{ name: 'Goal A' }]),
    };
    const impactRepository = {
      replaceForOpportunity: jest.fn().mockResolvedValue(undefined),
      findForOpportunity: jest.fn().mockResolvedValue([]),
      findNeedingAssessment: jest.fn().mockResolvedValue(['a', 'b', 'c']),
      countNeedingAssessment: jest.fn().mockResolvedValue(1),
    };
    const opportunityRepository = {
      findOne: jest
        .fn()
        .mockImplementation(async ({ where }: { where: { id: string } }) =>
          where.id === 'b' ? null : { id: where.id, description: 'draft' },
        ),
    };
    const service = new RoadmapGoalImpactService(
      goalRepository as never,
      impactRepository as never,
      opportunityRepository as never,
      { assessGoalImpact: jest.fn().mockResolvedValue([]) } as never,
      { emit: jest.fn() } as never,
    );

    // 'b' throws NotFoundException; the run still reaches 'c'.
    await expect(service.assessMissing(ACTOR)).resolves.toEqual({
      assessed: 2,
      failed: 1,
      remaining: 1,
    });
  });
});

/**
 * The model-answer parsing, which is where a wrong number would come from. Every case below is
 * a way the model can under- or over-deliver, and all of them have to leave the numerator no
 * bigger than the truth.
 */
describe('RoadmapAiService.assessGoalImpact', () => {
  const buildAi = (parsed: unknown) => {
    const service = Object.create(
      RoadmapAiService.prototype,
    ) as RoadmapAiService;
    (service as unknown as Record<string, unknown>).runJson = jest
      .fn()
      .mockResolvedValue(parsed);
    (service as unknown as Record<string, unknown>).logger = {
      warn: jest.fn(),
    };
    return service;
  };

  it('returns one verdict per goal, in the order given, joined by NAME not position', async () => {
    // The prompt asks for the given order but the join is by name, so a reordered answer must
    // still land each verdict on its own goal rather than shifting them all by one.
    const ai = buildAi({
      verdicts: [
        { goal: 'Goal B', helped: true, reason: 'b' },
        { goal: 'Goal A', helped: false, reason: 'a' },
      ],
    });

    await expect(
      ai.assessGoalImpact('draft', ['Goal A', 'Goal B']),
    ).resolves.toEqual([
      { goalName: 'Goal A', helped: false, reason: 'a' },
      { goalName: 'Goal B', helped: true, reason: 'b' },
    ]);
  });

  it('fails a missing verdict CLOSED rather than dropping the goal', async () => {
    // Dropping it would shrink the numerator and leave the denominator alone, which reads as
    // "assessed, does not help" — the same score by accident. Returning it explicitly false
    // with a reason makes the gap visible in the drawer instead.
    const ai = buildAi({ verdicts: [{ goal: 'Goal A', helped: true }] });

    const result = await ai.assessGoalImpact('draft', ['Goal A', 'Goal B']);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      goalName: 'Goal B',
      helped: false,
      reason:
        'Not assessed — the model did not return a verdict for this goal.',
    });
  });

  it('fails a non-boolean verdict closed', async () => {
    const ai = buildAi({
      verdicts: [{ goal: 'Goal A', helped: 'yes' as unknown as boolean }],
    });

    const [verdict] = await ai.assessGoalImpact('draft', ['Goal A']);
    expect(verdict.helped).toBe(false);
  });

  it('drops a hallucinated goal instead of failing the whole assessment', async () => {
    // The FK would reject an invented name anyway; catching it here means one bad name does
    // not cost the other verdicts in the same answer.
    const ai = buildAi({
      verdicts: [
        { goal: 'Goal A', helped: true, reason: 'real' },
        { goal: 'Invented Goal', helped: true, reason: 'not a live goal' },
      ],
    });

    await expect(ai.assessGoalImpact('draft', ['Goal A'])).resolves.toEqual([
      { goalName: 'Goal A', helped: true, reason: 'real' },
    ]);
  });

  it('fails everything closed when the model output was unparseable', async () => {
    // runJson returns null on unparseable output. Every goal must come back false, not absent.
    const ai = buildAi(null);

    const result = await ai.assessGoalImpact('draft', ['Goal A', 'Goal B']);
    expect(result.map((v) => v.helped)).toEqual([false, false]);
  });

  it('does not call the model for an empty goal list', async () => {
    const ai = buildAi({ verdicts: [] });

    await expect(ai.assessGoalImpact('draft', [])).resolves.toEqual([]);
    expect(
      (ai as unknown as Record<string, jest.Mock>).runJson,
    ).not.toHaveBeenCalled();
  });
});
