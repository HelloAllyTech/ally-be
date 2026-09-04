import { RoadmapAiService } from '../roadmap-ai.service';
import { ROADMAP_READINESS_CRITERIA } from '../../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../../enum/roadmap-opportunity.enum';

type ModelAnswer = {
  reply?: string;
  gates?: { id?: string; met?: boolean; note?: string }[];
  draft?: {
    description?: string;
    productGoal?: string | null;
    effort?: string | null;
  } | null;
};

/**
 * interviewTurn feeds a GATE — its draft is filed with a signed readiness token — so what
 * matters here is not the conversation but what happens to answers the model gave badly, and
 * whether a token can ever be minted for something the five criteria did not actually clear.
 *
 * The LLM round trip is stubbed at `runJson`, the same seam roadmap-ai-readiness.service.spec
 * uses: everything under test is the mapping between the model's JSON and the drawer.
 */
describe('RoadmapAiService.interviewTurn', () => {
  const allIds = ROADMAP_READINESS_CRITERIA.map((c) => c.id);

  const build = (
    answer: ModelAnswer | null,
    goals = ['Reliability & Trust'],
  ) => {
    const service = Object.create(
      RoadmapAiService.prototype,
    ) as RoadmapAiService;
    const runJson = jest.fn().mockResolvedValue(answer);
    (service as unknown as { runJson: unknown }).runJson = runJson;
    (service as unknown as { logger: unknown }).logger = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    (service as unknown as { goalRepository: unknown }).goalRepository = {
      findAllOrdered: jest
        .fn()
        .mockResolvedValue(goals.map((name) => ({ name }))),
    };
    // Signing has its own suite; here it only has to be observable. The stub echoes its input
    // so the assertions about WHAT gets signed can read it without a key.
    const issue = jest.fn((input) => JSON.stringify(input));
    (service as unknown as { readinessToken: unknown }).readinessToken = {
      issue,
    };
    return { service, runJson, issue };
  };

  const allMet = (over: Partial<ModelAnswer> = {}): ModelAnswer => ({
    reply: 'All five are covered — check the draft.',
    gates: allIds.map((id) => ({ id, met: true, note: 'Covered.' })),
    draft: {
      description:
        'As a counsellor, retyping the name wastes a minute — so that…',
      productGoal: 'Reliability & Trust',
      effort: 'm',
    },
    ...over,
  });

  it('returns one gate per criterion, in the criteria order', async () => {
    const { service } = build(allMet());

    const turn = await service.interviewTurn([]);

    expect(turn.gates.map((g) => g.id)).toEqual(allIds);
  });

  /** The whole design: anything the model failed to answer must read as "not established yet". */
  it('fails closed on a missing gate, a non-boolean one, and unparseable output', async () => {
    const { service } = build(
      allMet({
        gates: [
          { id: allIds[0], met: true, note: 'Covered.' },
          // Answered outside the schema — "yes" is not true.
          { id: allIds[1], met: 'yes' as unknown as boolean, note: 'Sure.' },
          // allIds[2..4] dropped entirely.
        ],
      }),
    );

    const turn = await service.interviewTurn([]);

    expect(turn.gates.map((g) => g.met)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    // And with a gate unmet there must be no draft and nothing signed, whatever the model said.
    expect(turn.draft).toBeNull();
    expect(turn.readinessToken).toBeNull();

    const { service: broken } = build(null);
    const dead = await broken.interviewTurn([]);
    expect(dead.gates.every((g) => !g.met)).toBe(true);
    expect(dead.draft).toBeNull();
    expect(dead.reply).toContain('Could you say it again?');
  });

  it('hands over a draft and signs a token only when every gate is met', async () => {
    const { service, issue } = build(allMet());

    const turn = await service.interviewTurn([
      { role: 'admin', content: 'Counsellors retype the name.' },
    ]);

    expect(turn.draft?.description).toContain('As a counsellor');
    expect(turn.draft?.productGoal).toBe('Reliability & Trust');
    expect(turn.draft?.effort).toBe(RoadmapOpportunityEffort.M);
    // Signed over the draft it handed over, with nothing recorded as failed — the claim the
    // filing gate then verifies.
    expect(issue).toHaveBeenCalledWith({
      description: turn.draft?.description,
      productGoal: 'Reliability & Trust',
      failedCriteria: [],
      proposedEffort: RoadmapOpportunityEffort.M,
    });
    expect(turn.readinessToken).toBeTruthy();
  });

  /**
   * A model that reports five green gates but forgets the draft must not end the interview: with
   * nothing to file, "done" would leave the admin at a dead end holding no opportunity.
   */
  it('keeps interviewing when every gate is met but no draft came back', async () => {
    const { service, issue } = build(allMet({ draft: null }));

    const turn = await service.interviewTurn([]);

    expect(turn.gates.every((g) => g.met)).toBe(true);
    expect(turn.draft).toBeNull();
    expect(turn.readinessToken).toBeNull();
    expect(issue).not.toHaveBeenCalled();
  });

  it('drops a product goal that is not a live one rather than inventing taxonomy', async () => {
    // Same rule as classifyGoal, for the same reason: an unvalidated model answer became stored
    // taxonomy once already, across 241 rows.
    const { service } = build(
      allMet({
        draft: {
          description: 'A well-formed draft',
          productGoal: 'Goals I Just Made Up',
          effort: 's',
        },
      }),
    );

    const turn = await service.interviewTurn([]);

    expect(turn.draft?.productGoal).toBeNull();
    // The draft still stands — a bad goal guess is not a reason to lose a finished interview.
    expect(turn.draft?.description).toBe('A well-formed draft');
  });

  it('hands over unsized rather than storing an effort that is not a live size', async () => {
    const { service } = build(
      allMet({
        draft: {
          description: 'A well-formed draft',
          productGoal: null,
          effort: 'medium-ish',
        },
      }),
    );

    const turn = await service.interviewTurn([]);

    expect(turn.draft?.effort).toBeNull();
  });

  /** The first call carries no transcript: that is how the client asks for the opening question. */
  it('asks the model to open the interview when there are no messages', async () => {
    const { service, runJson } = build(
      allMet({ gates: [], draft: null, reply: 'Who is this for?' }),
    );

    const turn = await service.interviewTurn([]);

    expect(turn.reply).toBe('Who is this for?');
    expect(runJson.mock.calls[0][1]).toContain('this is the first turn');
  });

  it('labels each turn by speaker so the model can tell its own words from the admin’s', async () => {
    const { service, runJson } = build(allMet());

    await service.interviewTurn([
      { role: 'agent', content: 'Who is this for?' },
      { role: 'admin', content: 'Counsellors.' },
    ]);

    const userMessage = runJson.mock.calls[0][1] as string;
    expect(userMessage).toContain('YOU: Who is this for?');
    expect(userMessage).toContain('ADMIN: Counsellors.');
  });
});
