import { BugFixPlanService, validateD6 } from '../bug-fix-plan.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    title: 'Marathi keys missing',
    source: 'code_review',
    severity: 'medium',
    status: BugFindingStatus.APPROVED,
    touchesGuardedPath: false,
    metadata: {},
    ...overrides,
  }) as BugFinding;

describe('validateD6', () => {
  it('accepts a pair on the menu and clips the approach; refuses anything else', () => {
    expect(
      validateD6({
        engine: 'gemini',
        model: 'gemini-2.5-pro',
        approach: ` ${'x'.repeat(400)} `,
      }),
    ).toEqual({
      engine: 'gemini',
      model: 'gemini-2.5-pro',
      approach: 'x'.repeat(300),
    });
    expect(validateD6({ engine: 'gemini', model: 'gemini-2.5-flash' })).toEqual(
      {
        engine: 'gemini',
        model: 'gemini-2.5-flash',
        approach: null,
      },
    );
    expect(
      validateD6({ engine: 'claude-code', model: 'claude-opus-5' }),
    ).toBeNull();
    expect(validateD6('gemini-2.5-pro')).toBeNull();
    expect(validateD6(null)).toBeNull();
  });
});

describe('BugFixPlanService', () => {
  let decisions: { decide: jest.Mock };
  let findingRepository: { update: jest.Mock };
  let service: BugFixPlanService;

  const decideWith = (modelPick: unknown = null) =>
    jest.fn().mockImplementation(async (req) => {
      const pick = modelPick ? req.validate(modelPick) : null;
      const modelActs = req.modelOwned && pick !== null;
      return {
        pick: modelActs ? pick : req.rule(),
        owner: modelActs ? 'model' : 'rule',
        shadowPick: modelActs ? req.rule() : pick,
        reason: modelActs ? 'scoreboard' : 'rule',
        confidence: null,
        record: { id: 'dec-D6' },
      };
    });

  beforeEach(() => {
    decisions = { decide: decideWith() };
    findingRepository = { update: jest.fn().mockResolvedValue(undefined) };
    service = new BugFixPlanService(
      decisions as never,
      {
        forRepo: jest.fn().mockResolvedValue({
          fixByModel: {
            'gemini/gemini-2.5-pro': {
              sessions: 4,
              merged: 3,
              failed: 1,
              passVerdicts: 3,
              failVerdicts: 1,
            },
          },
        }),
      } as never,
      {
        get: jest.fn().mockResolvedValue({
          engine: 'gemini',
          defaultModel: 'gemini-2.5-flash',
          escalationModel: 'gemini-2.5-pro',
        }),
      } as never,
      findingRepository as never,
    );
  });

  it('rule: a first attempt runs on the platform default, stored as attempt 1', async () => {
    const f = finding();
    const plan = await service.plan(f, 'ally-web', null);
    expect(plan).toMatchObject({
      engine: 'gemini',
      model: 'gemini-2.5-flash',
      tier: 'fast',
      approach: null,
      attempt: 1,
      decisionId: 'dec-D6',
    });
    expect(findingRepository.update).toHaveBeenCalledWith(
      'f-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ fixPlan: plan }),
      }),
    );
    const req = decisions.decide.mock.calls[0][0];
    expect(req.point).toBe('D6');
    expect(req.context.fixByModel['gemini/gemini-2.5-pro'].merged).toBe(3);
  });

  it('rule: a retry goes to the strong tier on a different pair than the one that failed', async () => {
    const f = finding({
      metadata: {
        fixPlan: {
          engine: 'gemini',
          model: 'gemini-2.5-pro',
          tier: 'strong',
          attempt: 1,
        },
      },
    });
    const plan = await service.plan(f, 'ally-web', {
      kind: 'verifier_fail',
      move: 'escalate_model',
      attempt: 1,
      failures: ['suite red'],
      prUrl: null,
      decisionId: 'dec-D7',
      at: new Date().toISOString(),
    });
    expect(plan).toMatchObject({
      engine: 'opencode',
      model: 'gemini-2.5-pro',
      tier: 'strong',
      attempt: 2,
    });
  });

  it('model: an on-menu pick with an approach wins and the approach is stored', async () => {
    decisions.decide = decideWith({
      engine: 'gemini',
      model: 'gemini-2.5-pro',
      approach:
        'Add the four keys to mr.json; the component already reads them.',
    });
    const plan = await service.plan(finding(), 'ally-web', null);
    expect(plan).toMatchObject({
      model: 'gemini-2.5-pro',
      approach:
        'Add the four keys to mr.json; the component already reads them.',
    });
  });

  it('never throws: a decision store that is down leaves the platform default to the workflow', async () => {
    decisions.decide.mockRejectedValueOnce(new Error('db down'));
    expect(await service.plan(finding(), 'ally-web', null)).toBeNull();
    expect(findingRepository.update).not.toHaveBeenCalled();
  });
});
