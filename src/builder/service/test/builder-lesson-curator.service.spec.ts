import {
  BuilderLessonCuratorService,
  parseOperations,
  scoreLesson,
} from '../builder-lesson-curator.service';
import {
  BuilderLessonCategory,
  BuilderLessonStatus,
} from '../../enum/builder.enum';

/**
 * The curator decides what Builder remembers, so its guardrails matter more
 * than its cleverness. Every test here is a way a tidying model can damage the
 * library: deleting what a human pinned, silently dropping a candidate it had
 * no opinion about, or letting the set grow past the budget it exists to
 * protect.
 */

const lesson = (overrides: Record<string, any> = {}) => ({
  id: 'l-1',
  sessionId: 's-1',
  lesson:
    'Migrations in ally-be need their CHECK rewritten when an enum widens.',
  category: BuilderLessonCategory.GOTCHA,
  status: BuilderLessonStatus.CANDIDATE,
  pinned: false,
  sourceCount: 1,
  sourceSessionIds: ['s-1'],
  timesApplied: 0,
  timesContradicted: 0,
  repos: ['ally-be'],
  ...overrides,
});

describe('BuilderLessonCuratorService', () => {
  let service: BuilderLessonCuratorService;
  let lessonRepository: any;
  let dataSource: any;
  let updates: { where: any; set: any }[];
  let reply: string;

  beforeEach(() => {
    updates = [];
    reply = '[]';

    const repoStub = {
      update: jest.fn(async (where: any, set: any) => {
        updates.push({ where, set });
      }),
    };
    dataSource = {
      transaction: jest.fn(async (fn: any) =>
        fn({ getRepository: () => repoStub }),
      ),
    };
    lessonRepository = {
      listByStatus: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (where: any, set: any) => {
        updates.push({ where, set });
      }),
    };

    service = new BuilderLessonCuratorService(
      {
        anthropic: { apiKey: 'test' },
        builder: { mechanicalModel: 'claude-haiku-4-5' },
      } as any,
      dataSource,
      lessonRepository,
      { record: jest.fn() } as any,
    );

    // Stand in for the model: whatever `reply` holds comes back as its text.
    (service as any).client = {
      messages: {
        create: jest.fn(async () => ({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    };
  });

  const withCandidates = (count: number, active: any[] = []) => {
    const candidates = Array.from({ length: count }, (_, index) =>
      lesson({ id: `c-${index}`, sessionId: `s-${index}` }),
    );
    lessonRepository.listByStatus.mockImplementation((status: string) =>
      Promise.resolve(
        status === BuilderLessonStatus.CANDIDATE ? candidates : active,
      ),
    );
    return candidates;
  };

  it('does nothing at all when there are no candidates', async () => {
    const result = await service.consolidate();

    expect(result.skipped).toBe('nothing new');
    // The no-op path is the common one, so it must not cost a model call.
    expect((service as any).client.messages.create).not.toHaveBeenCalled();
  });

  it('waits for a batch rather than spending a call per build', async () => {
    withCandidates(2);

    const result = await service.consolidate();

    expect(result.skipped).toBe('below the batch threshold');
    expect((service as any).client.messages.create).not.toHaveBeenCalled();
  });

  it('runs on demand below the threshold when forced', async () => {
    withCandidates(2);

    await service.consolidate(true);

    expect((service as any).client.messages.create).toHaveBeenCalled();
  });

  it('folds a duplicate into the rule it agrees with, counting the agreement', async () => {
    // The whole point: five builds hitting one trap should become one rule
    // with a count of five, not five rows competing for the same slot.
    const active = [
      lesson({ id: 'a-1', status: BuilderLessonStatus.ACTIVE, sourceCount: 2 }),
    ];
    const candidates = withCandidates(10, active);
    reply = JSON.stringify([
      { op: 'AGREE', id: 'a-1', candidateId: candidates[0].id },
    ]);

    await service.consolidate();

    const agreed = updates.find((u) => u.where.id === 'a-1');
    expect(agreed?.set.sourceCount).toBe(3);
    const tombstoned = updates.find((u) => u.where.id === candidates[0].id);
    expect(tombstoned?.set.status).toBe(BuilderLessonStatus.MERGED);
    expect(tombstoned?.set.mergedIntoId).toBe('a-1');
  });

  it('refuses to edit a pinned lesson', async () => {
    // A person who decided a rule matters outranks a model's tidying pass —
    // without this the consolidation pass would be something to distrust.
    const active = [
      lesson({ id: 'a-1', status: BuilderLessonStatus.ACTIVE, pinned: true }),
    ];
    withCandidates(10, active);
    reply = JSON.stringify([
      { op: 'EDIT', id: 'a-1', lesson: 'Something blander.' },
    ]);

    await service.consolidate();

    expect(updates.find((u) => u.where.id === 'a-1')).toBeUndefined();
  });

  it('refuses to retire a pinned lesson', async () => {
    const active = [
      lesson({ id: 'a-1', status: BuilderLessonStatus.ACTIVE, pinned: true }),
    ];
    withCandidates(10, active);
    reply = JSON.stringify([{ op: 'REMOVE', id: 'a-1' }]);

    await service.consolidate();

    expect(updates.find((u) => u.where.id === 'a-1')).toBeUndefined();
  });

  it('promotes a candidate the model said nothing about', async () => {
    // Silence is not a decision. Leaving it `candidate` would make it
    // invisible to every prompt forever — a lesson lost to indifference.
    const candidates = withCandidates(10);
    reply = JSON.stringify([{ op: 'ADD', id: candidates[0].id }]);

    await service.consolidate();

    for (const candidate of candidates) {
      const update = updates.find((u) => u.where.id === candidate.id);
      expect(update?.set.status).toBe(BuilderLessonStatus.ACTIVE);
    }
  });

  it('promotes everything uncurated when the model is unavailable', async () => {
    // An uncurated lesson still beats a lost one.
    withCandidates(10);
    (service as any).client.messages.create = jest
      .fn()
      .mockRejectedValue(new Error('anthropic down'));

    const result = await service.consolidate();

    expect(result.skipped).toMatch(/promoted uncurated/);
    expect(lessonRepository.update).toHaveBeenCalled();
  });

  it('ignores an operation naming a lesson it was never shown', async () => {
    withCandidates(10);
    reply = JSON.stringify([{ op: 'REMOVE', id: 'not-a-real-id' }]);

    await service.consolidate();

    expect(updates.find((u) => u.where.id === 'not-a-real-id')).toBeUndefined();
  });

  describe('the active cap', () => {
    it('retires the weakest to stay inside it, and never a pinned one', async () => {
      const active = [
        // Pinned but weakest by score — must survive anyway.
        lesson({
          id: 'pinned',
          status: BuilderLessonStatus.ACTIVE,
          pinned: true,
          sourceCount: 1,
          timesContradicted: 5,
        }),
        ...Array.from({ length: 85 }, (_, index) =>
          lesson({
            id: `a-${index}`,
            status: BuilderLessonStatus.ACTIVE,
            sourceCount: index + 2,
          }),
        ),
      ];
      lessonRepository.listByStatus.mockImplementation((status: string) =>
        Promise.resolve(status === BuilderLessonStatus.ACTIVE ? active : []),
      );

      await service.consolidate(true);

      const retired = updates.filter(
        (u) => u.set.status === BuilderLessonStatus.RETIRED,
      );
      expect(retired.length).toBeGreaterThan(0);
      expect(retired.some((u) => u.where.id === 'pinned')).toBe(false);
      // Weakest unpinned first: a-0 has the lowest sourceCount.
      expect(retired.some((u) => u.where.id === 'a-0')).toBe(true);
    });
  });
});

describe('scoreLesson', () => {
  it('rewards independent agreement and use, and penalises being contradicted', () => {
    // Recency is deliberately absent: a lesson five builds confirmed should
    // outrank one written yesterday, which recency-ordering got backwards.
    expect(
      scoreLesson(lesson({ sourceCount: 5, timesApplied: 2 }) as any),
    ).toBe(7);
    expect(
      scoreLesson(
        lesson({
          sourceCount: 5,
          timesApplied: 2,
          timesContradicted: 3,
        }) as any,
      ),
    ).toBe(1);
  });
});

describe('parseOperations', () => {
  it('reads a bare array', () => {
    expect(parseOperations('[{"op":"ADD","id":"x"}]')).toEqual([
      expect.objectContaining({ op: 'ADD', id: 'x' }),
    ]);
  });

  it('reads a fenced array with prose around it', () => {
    const text =
      'Here is what I would do:\n```json\n[{"op":"REMOVE","id":"y"}]\n```\nDone.';
    expect(parseOperations(text)).toEqual([
      expect.objectContaining({ op: 'REMOVE', id: 'y' }),
    ]);
  });

  it('reads an object wrapper', () => {
    expect(
      parseOperations('{"operations":[{"op":"EDIT","id":"z","lesson":"a"}]}'),
    ).toEqual([expect.objectContaining({ op: 'EDIT', id: 'z' })]);
  });

  it('drops operations with an unknown op', () => {
    expect(parseOperations('[{"op":"DELETE_EVERYTHING","id":"x"}]')).toEqual(
      [],
    );
  });

  it('returns nothing on unparseable output rather than throwing', () => {
    // Which the caller turns into "promote uncurated" — the safe direction.
    expect(parseOperations('I have decided not to answer in JSON.')).toEqual(
      [],
    );
  });

  it('drops a category it does not recognise instead of storing it', () => {
    const [operation] = parseOperations(
      '[{"op":"EDIT","id":"x","lesson":"a","category":"vibes"}]',
    );
    expect(operation.category).toBeUndefined();
  });
});
