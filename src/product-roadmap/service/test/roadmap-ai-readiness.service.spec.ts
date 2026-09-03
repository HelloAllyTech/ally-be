import { RoadmapAiService } from '../roadmap-ai.service';
import {
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_READINESS_CRITERIA,
} from '../../constants/product-roadmap.constants';

type ModelAnswer = {
  results?: { id?: string; passed?: boolean; reason?: string }[];
  effort?: string;
  effortReason?: string;
  redraft?: string | null;
};

/**
 * checkReadiness is a GATE, so the only interesting behaviour is what happens to answers the
 * model did not give properly — and, since the redraft landed, when a rewrite is offered.
 *
 * The LLM round trip is stubbed at `runJson`: everything under test is the mapping that sits
 * between the model's JSON and the drawer, which is where a dropped field turns into a green
 * tick nobody earned.
 */
describe('RoadmapAiService.checkReadiness', () => {
  const allIds = ROADMAP_READINESS_CRITERIA.map((c) => c.id);

  const build = (answer: ModelAnswer | null) => {
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
    // Signing is RoadmapReadinessTokenService's job and has its own suite; here it only has to
    // not be undefined. The stub echoes what it was asked to sign so the two assertions about
    // what lands IN the token can read it without a key.
    const issue = jest.fn((input) => JSON.stringify(input));
    (service as unknown as { readinessToken: unknown }).readinessToken = {
      issue,
    };
    return { service, runJson, issue };
  };

  const passingAnswer = (over: Partial<ModelAnswer> = {}): ModelAnswer => ({
    results: allIds.map((id) => ({ id, passed: true, reason: 'Met.' })),
    effort: 'm',
    effortReason: 'About a sprint.',
    redraft: null,
    ...over,
  });

  it('returns one verdict per criterion, in the criteria order', async () => {
    const { service } = build(passingAnswer());

    const report = await service.checkReadiness('A well-formed draft');

    expect(report.results.map((r) => r.id)).toEqual(allIds);
  });

  /** The whole design: anything the model failed to answer must read as "not yet". */
  it('fails closed on a missing verdict, a non-boolean one, and unparseable output', async () => {
    const { service } = build(
      passingAnswer({
        results: [
          // One id dropped entirely, one answered outside the schema.
          { id: allIds[0], passed: true, reason: 'Met.' },
          {
            id: allIds[1],
            passed: 'yes' as unknown as boolean,
            reason: 'Looks fine',
          },
          ...allIds
            .slice(3)
            .map((id) => ({ id, passed: true, reason: 'Met.' })),
        ],
      }),
    );

    const report = await service.checkReadiness('A draft');

    expect(report.results.find((r) => r.id === allIds[1])?.passed).toBe(false);
    expect(report.results.find((r) => r.id === allIds[2])?.passed).toBe(false);

    const { service: dead } = build(null);
    const unparseable = await dead.checkReadiness('A draft');
    expect(unparseable.results).toHaveLength(allIds.length);
    expect(unparseable.results.every((r) => !r.passed)).toBe(true);
  });

  it('drops a size that is not a live effort value rather than guessing', async () => {
    const { service } = build(passingAnswer({ effort: 'medium-ish' }));

    const report = await service.checkReadiness('A draft');

    expect(report.effort).toBeNull();
    expect(report.effortReason).toBe('');
  });

  it('offers no redraft when everything passed at a fileable size', async () => {
    const { service } = build(
      passingAnswer({ redraft: 'A tidier version nobody asked for' }),
    );

    const report = await service.checkReadiness('A well-formed draft');

    expect(report.redraft).toBeNull();
  });

  it('offers the redraft when a criterion failed', async () => {
    const { service } = build(
      passingAnswer({
        results: allIds.map((id, i) => ({
          id,
          passed: i !== 0,
          reason: i === 0 ? 'No benefit stated.' : 'Met.',
        })),
        redraft:
          'As a counsellor, [what is the pain?] — so that [what changes?].',
      }),
    );

    const report = await service.checkReadiness('Add a dashboard');

    expect(report.redraft).toContain('As a counsellor');
  });

  /**
   * Size is the one gate item the model does not vote on, so a draft can come back all-green
   * and still be unfileable. That is exactly the case the redraft has real work to do in —
   * narrowing — so it must not be suppressed by the verdicts alone.
   */
  it('offers the redraft when every criterion passed but the size is too big', async () => {
    const { service } = build(
      passingAnswer({ effort: 'xl', redraft: 'One shippable slice of it' }),
    );

    const report = await service.checkReadiness('A quarter of work');

    expect(report.results.every((r) => r.passed)).toBe(true);
    expect(report.redraft).toBe('One shippable slice of it');
    expect((ROADMAP_FILEABLE_EFFORTS as readonly string[]).includes('xl')).toBe(
      false,
    );
  });

  /** Unsized is not a pass: "we could not tell how big this is" still needs narrowing. */
  it('offers the redraft when the size came back unusable', async () => {
    const { service } = build(
      passingAnswer({ effort: undefined, redraft: 'A sharper version' }),
    );

    const report = await service.checkReadiness('A vague draft');

    expect(report.effort).toBeNull();
    expect(report.redraft).toBe('A sharper version');
  });
});
