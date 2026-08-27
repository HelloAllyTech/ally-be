import {
  BuilderOutcomeService,
  parseAnalysis,
} from '../builder-outcome.service';
import {
  BuilderExemplarOutcome,
  BuilderFailureTag,
  BuilderLessonCategory,
  BuilderPrFeedbackKind,
} from '../../enum/builder.enum';

/**
 * The feedback half of the flywheel. What matters is that credit and blame are
 * assigned on evidence: a lesson only earns credit when the work that cited it
 * was actually accepted, and a lesson only gets marked against when it failed
 * to prevent the thing it warns about.
 */

const exemplar = (overrides: Record<string, any> = {}) => ({
  id: 'e-1',
  sessionId: 'session-1',
  title: 'Add a changelog digest',
  repos: ['ally-be'],
  outcome: BuilderExemplarOutcome.MERGED,
  fixRunCount: 0,
  failureTags: null,
  ...overrides,
});

describe('BuilderOutcomeService', () => {
  let service: BuilderOutcomeService;
  let exemplarService: any;
  let feedbackRepository: any;
  let reportRepository: any;
  let lessonRepository: any;
  let knowledgeService: any;
  let curatorService: any;
  let reply: string;

  beforeEach(() => {
    reply = JSON.stringify({
      tags: ['review_correctness'],
      lessons: [
        {
          category: 'gotcha',
          lesson:
            'Queries in ally-be must filter by tenantId or they leak across orgs.',
        },
      ],
      contradictedLessonIds: [],
    });

    exemplarService = {
      refreshOutcome: jest.fn(),
      findBySession: jest.fn().mockResolvedValue(exemplar()),
      recordFailureTags: jest.fn(),
      listUnsettled: jest.fn().mockResolvedValue([]),
    };
    feedbackRepository = { listBySession: jest.fn().mockResolvedValue([]) };
    reportRepository = { listBySession: jest.fn().mockResolvedValue([]) };
    lessonRepository = {
      listActiveForRepos: jest.fn().mockResolvedValue([]),
      recordApplied: jest.fn(),
      recordContradicted: jest.fn(),
    };
    knowledgeService = { recordLesson: jest.fn() };
    curatorService = { consolidate: jest.fn().mockResolvedValue({}) };

    service = new BuilderOutcomeService(
      {
        anthropic: { apiKey: 'test' },
        builder: { mechanicalModel: 'claude-haiku-4-5' },
      } as any,
      { findOne: jest.fn() } as any,
      { listBySession: jest.fn().mockResolvedValue([]) } as any,
      feedbackRepository,
      reportRepository,
      lessonRepository,
      exemplarService,
      knowledgeService,
      curatorService,
      { record: jest.fn() } as any,
    );

    (service as any).client = {
      messages: {
        create: jest.fn(async () => ({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    };
  });

  const withFeedback = (items: Record<string, any>[]) =>
    feedbackRepository.listBySession.mockResolvedValue(items);

  it('spends nothing on a build that merged cleanly', async () => {
    // Merged, no fix runs, no comments: there is nothing to learn and saying
    // so would cost a model call per clean build.
    await service.processSession('session-1');

    expect((service as any).client.messages.create).not.toHaveBeenCalled();
    expect(knowledgeService.recordLesson).not.toHaveBeenCalled();
  });

  it('waits until the outcome is settled', async () => {
    // An open PR has not told us anything yet; categorising it would record a
    // verdict on work nobody has judged.
    exemplarService.findBySession.mockResolvedValue(
      exemplar({ outcome: BuilderExemplarOutcome.OPEN }),
    );

    await service.processSession('session-1');

    expect((service as any).client.messages.create).not.toHaveBeenCalled();
  });

  it('turns a review comment into a candidate lesson', async () => {
    // The highest-value signal in the system: a person explained exactly what
    // was wrong, and it used to evaporate into GitHub unread.
    exemplarService.findBySession.mockResolvedValue(
      exemplar({ outcome: BuilderExemplarOutcome.CLOSED_UNMERGED }),
    );
    withFeedback([
      {
        kind: BuilderPrFeedbackKind.REVIEW_COMMENT,
        author: 'a-reviewer',
        body: 'This leaks across tenants.',
        path: 'src/foo.ts',
      },
    ]);

    await service.processSession('session-1');

    expect(knowledgeService.recordLesson).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        repos: ['ally-be'],
        category: BuilderLessonCategory.GOTCHA,
      }),
    );
    expect(exemplarService.recordFailureTags).toHaveBeenCalledWith(
      'session-1',
      [BuilderFailureTag.REVIEW_CORRECTNESS],
    );
  });

  it('does not re-record a tag the exemplar already carries', async () => {
    exemplarService.findBySession.mockResolvedValue(
      exemplar({
        outcome: BuilderExemplarOutcome.CLOSED_UNMERGED,
        failureTags: [BuilderFailureTag.REVIEW_CORRECTNESS],
      }),
    );
    withFeedback([
      { kind: BuilderPrFeedbackKind.REVIEW_COMMENT, body: 'again' },
    ]);

    await service.processSession('session-1');

    expect(exemplarService.recordFailureTags).not.toHaveBeenCalled();
  });

  describe('lesson credit', () => {
    const citedLessons = () =>
      reportRepository.listBySession.mockResolvedValue([
        { metrics: { appliedLessonIds: ['l-1', 'l-2'] } },
      ]);

    it('credits cited lessons when the work was accepted', async () => {
      exemplarService.findBySession.mockResolvedValue(
        exemplar({ outcome: BuilderExemplarOutcome.MERGED, fixRunCount: 2 }),
      );
      citedLessons();

      await service.processSession('session-1');

      expect(lessonRepository.recordApplied).toHaveBeenCalledWith([
        'l-1',
        'l-2',
      ]);
    });

    it('withholds credit when the work was rejected', async () => {
      // A lesson cited by a pull request nobody accepted has not been shown to
      // have helped — crediting it would reward the wrong thing.
      exemplarService.findBySession.mockResolvedValue(
        exemplar({ outcome: BuilderExemplarOutcome.CLOSED_UNMERGED }),
      );
      citedLessons();
      withFeedback([
        { kind: BuilderPrFeedbackKind.REVIEW_COMMENT, body: 'no' },
      ]);

      await service.processSession('session-1');

      expect(lessonRepository.recordApplied).not.toHaveBeenCalled();
    });

    it('marks a lesson against when it failed to prevent the problem', async () => {
      exemplarService.findBySession.mockResolvedValue(
        exemplar({ outcome: BuilderExemplarOutcome.CLOSED_UNMERGED }),
      );
      lessonRepository.listActiveForRepos.mockResolvedValue([
        { id: 'l-9', lesson: 'Filter by tenantId.' },
      ]);
      withFeedback([
        { kind: BuilderPrFeedbackKind.REVIEW_COMMENT, body: 'leaks tenants' },
      ]);
      reply = JSON.stringify({
        tags: ['review_correctness'],
        lessons: [],
        contradictedLessonIds: ['l-9'],
      });

      await service.processSession('session-1');

      expect(lessonRepository.recordContradicted).toHaveBeenCalledWith(['l-9']);
    });

    it('ignores a contradicted id the model invented', async () => {
      // An id nobody was shown would penalise the wrong lesson, or nothing.
      exemplarService.findBySession.mockResolvedValue(
        exemplar({ outcome: BuilderExemplarOutcome.CLOSED_UNMERGED }),
      );
      lessonRepository.listActiveForRepos.mockResolvedValue([
        { id: 'l-real', lesson: 'x' },
      ]);
      withFeedback([{ kind: BuilderPrFeedbackKind.REVIEW_COMMENT, body: 'y' }]);
      reply = JSON.stringify({
        tags: [],
        lessons: [],
        contradictedLessonIds: ['l-invented'],
      });

      await service.processSession('session-1');

      expect(lessonRepository.recordContradicted).not.toHaveBeenCalled();
    });
  });

  describe('sweep', () => {
    it('keeps going when one session throws', async () => {
      exemplarService.listUnsettled.mockResolvedValue([
        { sessionId: 'bad' },
        { sessionId: 'good' },
      ]);
      exemplarService.refreshOutcome
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      const result = await service.sweep();

      expect(result.refreshed).toBe(1);
      expect(exemplarService.refreshOutcome).toHaveBeenCalledTimes(2);
    });

    it('curates whatever it harvested on the way out', async () => {
      await service.sweep();

      expect(curatorService.consolidate).toHaveBeenCalled();
    });
  });
});

describe('parseAnalysis', () => {
  const known = new Set(['l-1']);

  it('keeps only recognised tags', () => {
    const result = parseAnalysis(
      '{"tags":["review_correctness","vibes_were_off"],"lessons":[],"contradictedLessonIds":[]}',
      known,
    );
    expect(result?.tags).toEqual([BuilderFailureTag.REVIEW_CORRECTNESS]);
  });

  it('drops a lesson too short to be useful', () => {
    // "be careful" costs a slot in a capped set and teaches nobody anything.
    const result = parseAnalysis(
      '{"tags":[],"lessons":[{"category":"gotcha","lesson":"careful"}],"contradictedLessonIds":[]}',
      known,
    );
    expect(result?.lessons).toEqual([]);
  });

  it('defaults an unrecognised category rather than dropping the lesson', () => {
    const result = parseAnalysis(
      '{"tags":[],"lessons":[{"category":"nonsense","lesson":"A genuinely useful and specific rule."}],"contradictedLessonIds":[]}',
      known,
    );
    expect(result?.lessons[0].category).toBe(BuilderLessonCategory.GOTCHA);
  });

  it('filters contradicted ids to the ones actually offered', () => {
    const result = parseAnalysis(
      '{"tags":[],"lessons":[],"contradictedLessonIds":["l-1","l-made-up"]}',
      known,
    );
    expect(result?.contradictedLessonIds).toEqual(['l-1']);
  });

  it('returns null on unparseable output', () => {
    expect(parseAnalysis('no json here', known)).toBeNull();
  });
});
