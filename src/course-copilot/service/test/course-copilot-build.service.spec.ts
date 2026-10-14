import { BadRequestException, ConflictException } from '@nestjs/common';
import { CourseCopilotJob } from '../../entity/course-copilot-job.entity';
import {
  CourseCopilotEventType,
  CourseCopilotJobKind as Kind,
  CourseCopilotJobStatus as Status,
  CourseCopilotMode,
  CourseCopilotSessionStatus as SessionStatus,
} from '../../enum/course-copilot.enum';
import {
  COURSE_COPILOT_JOB_HEARTBEAT_MS,
  COURSE_COPILOT_JOB_STALE_MS,
} from '../../constants/course-copilot.constants';
import { CourseBlueprint } from '../../type/course-copilot.type';
import { SpecialistValidationError } from '../specialists/specialist.types';
import { item as bpItem } from '../specialists/test/specialist-test.fixtures';
import { CourseCopilotJobSkip } from '../course-copilot-media.service';
import {
  CourseCopilotBuildService,
  jobKindForItem,
} from '../course-copilot-build.service';
import { CourseCopilotStructureService } from '../course-copilot-structure.service';
import {
  FakeEventService,
  FakeJobRepository,
  FakeSessionRepository,
  FakeTrackStore,
  makeJob,
  makeSession,
} from './course-copilot-test.fixtures';

/**
 * A scripted stand-in for the job executor. Each job is identified by its
 * `input.title`; a spec scripts what its attempts do (succeed, throw, wait on
 * a gate) and reads back what ran, in what order, and how many at once.
 */
class FakeExecutor {
  /** `start:<title>` / `end:<title>` in the order they happened. */
  log: string[] = [];
  calls: { title: string; attempt: number; input: Record<string, any> }[] = [];
  active = 0;
  maxActive = 0;
  results = new Map<string, Record<string, any>>();
  private plans = new Map<string, (Error | 'ok')[]>();
  private gates = new Map<string, Promise<void>>();
  private hooks = new Map<string, () => void>();

  /** What attempt 1, 2, … of this job does. Unscripted attempts succeed. */
  plan(title: string, ...steps: (Error | 'ok')[]) {
    this.plans.set(title, steps);
  }

  /** Hold this job's execution until the returned function is called. */
  gate(title: string): () => void {
    let release!: () => void;
    this.gates.set(title, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  /** Run `fn` as the job finishes executing, before it is settled. */
  onFinish(title: string, fn: () => void) {
    this.hooks.set(title, fn);
  }

  startsOf() {
    return this.log
      .filter((entry) => entry.startsWith('start:'))
      .map((e) => e.slice(6));
  }

  execute = jest.fn(async (_session: any, job: CourseCopilotJob) => {
    const title = job.input.title as string;
    this.log.push(`start:${title}`);
    this.calls.push({
      title,
      attempt: job.attempts,
      input: JSON.parse(JSON.stringify(job.input)),
    });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await this.gates.get(title);
      const step = this.plans.get(title)?.shift();
      if (step instanceof Error) throw step;
      this.hooks.get(title)?.();
      return { summary: `built ${title}`, ...(this.results.get(title) ?? {}) };
    } finally {
      this.active -= 1;
      this.log.push(`end:${title}`);
    }
  });
}

describe('CourseCopilotBuildService', () => {
  let service: CourseCopilotBuildService;
  let jobs: FakeJobRepository;
  let sessions: FakeSessionRepository;
  let events: FakeEventService;
  let executor: FakeExecutor;
  let store: FakeTrackStore;
  let structure: CourseCopilotStructureService;
  let redis: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let config: { courseCopilot: { buildConcurrency: number } };
  let cost: { spent: jest.Mock };
  let scheduleWrite: jest.SpyInstance;
  let flushWrite: jest.SpyInstance;

  const emptyBlueprint = {
    title: 't',
    sections: [],
  } as unknown as CourseBlueprint;

  /** Everything is rebuilt per test; fake timers drive the runner's 1s polls. */
  const build = (
    opts: { concurrency?: number; trackSections?: any[] } = {},
  ) => {
    jobs = new FakeJobRepository();
    sessions = new FakeSessionRepository();
    events = new FakeEventService();
    executor = new FakeExecutor();
    store = new FakeTrackStore(opts.trackSections ?? []);
    // A real lock, not a yes-machine: concurrent edit-loop placements only stay
    // correct because the structure lock serialises them.
    const held = new Set<string>();
    redis = {
      acquireLock: jest.fn(async (key: string) => {
        if (held.has(key)) return false;
        held.add(key);
        return true;
      }),
      releaseLock: jest.fn(async (key: string) => {
        held.delete(key);
      }),
    };
    config = { courseCopilot: { buildConcurrency: opts.concurrency ?? 4 } };
    cost = { spent: jest.fn().mockResolvedValue(0) };

    // The real structure service, over an in-memory course: the edit-loop
    // placement paths go through its `mutate`, which is worth exercising.
    structure = new CourseCopilotStructureService(
      { getRepository: jest.fn() } as any,
      redis as any,
      { upsertStructure: store.upsertStructure } as any,
      { getTrackWithStructure: store.getTrackWithStructure } as any,
      sessions as any,
      jobs as any,
      events as any,
    );
    scheduleWrite = jest
      .spyOn(structure, 'scheduleBuildWrite')
      .mockImplementation(() => undefined);
    flushWrite = jest
      .spyOn(structure, 'flushBuildWrite')
      .mockResolvedValue(undefined);

    service = new CourseCopilotBuildService(
      config as any,
      redis as any,
      sessions as any,
      jobs as any,
      structure,
      executor as any,
      cost as any,
      events as any,
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    build();
    sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A job whose title is its id, for readable logs. */
  const job = (id: string, kind: Kind, extra: Partial<CourseCopilotJob> = {}) =>
    makeJob({
      id,
      sessionId: 'session-1',
      kind,
      input: { title: id },
      ...extra,
    });

  const drain = () => jest.advanceTimersByTimeAsync(0);

  /** Let fake time pass until a runner the test already started exits. */
  const settleRunner = async (sessionId = 'session-1') => {
    let finished = false;
    const done = service.waitFor(sessionId).then(() => {
      finished = true;
    });
    for (let i = 0; i < 300 && !finished; i += 1) {
      await jest.advanceTimersByTimeAsync(1_000);
    }
    await done;
    expect(finished).toBe(true);
  };

  /** Start the runner and run it to the end. */
  const runToEnd = async (sessionId = 'session-1') => {
    service.start(sessionId);
    await settleRunner(sessionId);
  };

  const statuses = () =>
    Object.fromEntries(jobs.rows.map((row) => [row.id, row.status]));

  // ── Job graph ────────────────────────────────────────────────────────────

  describe('jobKindForItem', () => {
    it.each([
      ['ARTICLE', { kind: 'new' }, Kind.ARTICLE],
      ['QUIZ', { kind: 'new' }, Kind.QUIZ],
      ['JOURNAL', { kind: 'new' }, Kind.JOURNAL],
      ['ANNOTATED_ARTIFACT', { kind: 'new' }, Kind.ANNOTATED_ARTIFACT],
      ['GAME', { kind: 'new' }, Kind.GAME],
      ['VIDEO', { kind: 'new' }, Kind.VIDEO],
      ['VIDEO', { kind: 'needs-input', what: 'video-url' }, Kind.VIDEO],
      ['ROLEPLAY', { kind: 'new' }, Kind.ROLEPLAY_NEW],
      ['ROLEPLAY', { kind: 'library', scenarioId: 5 }, Kind.ROLEPLAY_REF],
      ['CASE', { kind: 'new' }, Kind.CASE_NEW],
      ['CASE', { kind: 'library', caseId: 'c' }, Kind.CASE_REF],
    ] as const)('%s from %j → %s', (type, source, expected) => {
      expect(
        jobKindForItem(bpItem({ id: 'x', type, source: source as any })),
      ).toBe(expected);
    });

    it('refuses an item type the copilot cannot build', () => {
      expect(() =>
        jobKindForItem(bpItem({ id: 'x', type: 'PODCAST' as any })),
      ).toThrow(/No job kind/);
    });
  });

  describe('createJobsForBlueprint', () => {
    const blueprint = (
      cover: CourseBlueprint['cover'] = { mode: 'generate', prompt: 'warm' },
    ): CourseBlueprint => ({
      title: 'Course',
      description: 'd',
      estimatedDurationMinutes: 60,
      competencyIds: [],
      cover,
      sections: [
        {
          id: 's1',
          title: 'One',
          description: '',
          purpose: '',
          items: [
            bpItem({
              id: 'art-img',
              type: 'ARTICLE',
              title: 'With image',
              spec: { withImage: true },
            }),
            bpItem({ id: 'art-plain', type: 'ARTICLE', title: 'Plain' }),
            bpItem({
              id: 'qz',
              type: 'QUIZ',
              title: 'Quiz',
              spec: { withImage: true },
            }),
            bpItem({ id: 'jr', type: 'JOURNAL' }),
            bpItem({ id: 'an', type: 'ANNOTATED_ARTIFACT' }),
            bpItem({ id: 'gm', type: 'GAME' }),
            bpItem({ id: 'vd', type: 'VIDEO' }),
          ],
        },
        {
          id: 's2',
          title: 'Two',
          description: '',
          purpose: '',
          items: [
            bpItem({ id: 'rp-1', type: 'ROLEPLAY', title: 'New one' }),
            bpItem({
              id: 'rp-lib',
              type: 'ROLEPLAY',
              title: 'Library one',
              source: { kind: 'library', scenarioId: 5 },
            }),
            bpItem({ id: 'rp-3', type: 'ROLEPLAY', title: 'New three' }),
            bpItem({
              id: 'case-new',
              type: 'CASE',
              title: 'New case',
              spec: { memberItemIds: ['rp-1', 'rp-3', 'not-in-the-plan'] },
            }),
            bpItem({
              id: 'case-lib',
              type: 'CASE',
              title: 'Library case',
              source: { kind: 'library', caseId: 'case-9' },
            }),
          ],
        },
      ],
      estimate: {
        usd: 2.5,
        minutes: 60,
        items: 12,
        newRoleplays: 2,
        images: 1,
      },
    });

    const create = async (
      bp: CourseBlueprint,
      brief: Record<string, any> = {},
    ) => service.createJobsForBlueprint(makeSession({ brief }), bp);

    const byItem = (list: CourseCopilotJob[], itemId: string, kind?: Kind) =>
      list.find(
        (j) => j.blueprintItemId === itemId && (!kind || j.kind === kind),
      )!;

    it('makes one job per item with the kind that realises it', async () => {
      const list = await create(blueprint());
      const kinds = Object.fromEntries(
        list
          .filter((j) => j.blueprintItemId && j.kind !== Kind.ARTICLE_IMAGE)
          .map((j) => [j.blueprintItemId, j.kind]),
      );
      expect(kinds).toMatchObject({
        'art-img': Kind.ARTICLE,
        'art-plain': Kind.ARTICLE,
        qz: Kind.QUIZ,
        jr: Kind.JOURNAL,
        an: Kind.ANNOTATED_ARTIFACT,
        gm: Kind.GAME,
        vd: Kind.VIDEO,
        'rp-1': Kind.ROLEPLAY_NEW,
        'rp-lib': Kind.ROLEPLAY_REF, // library roleplay: no generation
        'rp-3': Kind.ROLEPLAY_NEW,
        'case-new': Kind.CASE_NEW,
        'case-lib': Kind.CASE_REF,
      });
    });

    it('carries the blueprint node and section on every item job, all queued at zero attempts', async () => {
      const list = await create(blueprint());
      const quiz = byItem(list, 'qz');
      expect(quiz).toMatchObject({
        sessionId: 'session-1',
        status: Status.QUEUED,
        attempts: 0,
        dependsOn: [],
        input: {
          title: 'Quiz',
          sectionId: 's1',
          item: { id: 'qz', type: 'QUIZ' },
        },
      });
      expect(
        list.every((j) => j.status === Status.QUEUED && j.attempts === 0),
      ).toBe(true);
      expect(jobs.rows).toHaveLength(list.length); // persisted, not just returned
    });

    it('always adds course meta first and the reviewer last, with no dependencies', async () => {
      const list = await create(blueprint({ mode: 'upload-later' }));
      expect(list[0]).toMatchObject({ kind: Kind.COURSE_META, dependsOn: [] });
      expect(list[list.length - 1]).toMatchObject({
        kind: Kind.COURSE_REVIEW,
        dependsOn: [],
      });
    });

    it('adds a cover job only when the cover is to be generated', async () => {
      const generate = await create(
        blueprint({ mode: 'generate', prompt: 'warm light' }),
      );
      const cover = generate.filter((j) => j.kind === Kind.COVER_IMAGE);
      expect(cover).toHaveLength(1);
      expect(cover[0].input).toMatchObject({ prompt: 'warm light' });

      for (const mode of ['library', 'upload-later'] as const) {
        const other = await create(
          blueprint({ mode, imageUrl: 'https://x.test/c.png' }),
        );
        expect(other.filter((j) => j.kind === Kind.COVER_IMAGE)).toHaveLength(
          0,
        );
      }
    });

    it('makes a new case wait for its member roleplays, ignoring members not in the plan', async () => {
      const list = await create(blueprint());
      const caseJob = byItem(list, 'case-new');
      expect(caseJob.dependsOn).toEqual([
        byItem(list, 'rp-1').id,
        byItem(list, 'rp-3').id,
      ]);
      // A library case is a reference — nothing to wait for.
      expect(byItem(list, 'case-lib').dependsOn).toEqual([]);
    });

    it('gives a case with no member list no dependencies rather than crashing', async () => {
      const bp = blueprint();
      bp.sections[1].items.find((i) => i.id === 'case-new')!.spec = {};
      const list = await create(bp);
      expect(byItem(list, 'case-new').dependsOn).toEqual([]);
    });

    it('adds an image only for articles flagged withImage by default, depending on that article', async () => {
      const list = await create(blueprint());
      const images = list.filter((j) => j.kind === Kind.ARTICLE_IMAGE);
      expect(images).toHaveLength(1);
      expect(images[0]).toMatchObject({
        blueprintItemId: 'art-img',
        dependsOn: [byItem(list, 'art-img', Kind.ARTICLE).id],
        input: { articleJobId: byItem(list, 'art-img', Kind.ARTICLE).id },
      });
      // `withImage` on a quiz means nothing: only articles get illustrated.
    });

    it('adds an image for every article when the brief asks for one-per-article', async () => {
      const list = await create(blueprint(), {
        look: { articleImages: 'one-per-article' },
      });
      const images = list.filter((j) => j.kind === Kind.ARTICLE_IMAGE);
      expect(images.map((j) => j.blueprintItemId).sort()).toEqual([
        'art-img',
        'art-plain',
      ]);
      for (const image of images) {
        expect(image.dependsOn).toEqual([
          byItem(list, image.blueprintItemId!, Kind.ARTICLE).id,
        ]);
      }
    });

    it.each(['none', 'cover-only'])(
      'does not add article images for articleImages=%s (unless withImage)',
      async (articleImages) => {
        const list = await create(blueprint(), { look: { articleImages } });
        expect(
          list
            .filter((j) => j.kind === Kind.ARTICLE_IMAGE)
            .map((j) => j.blueprintItemId),
        ).toEqual(['art-img']);
      },
    );

    it('records build_started with the job count and the estimate', async () => {
      const list = await create(blueprint());
      expect(events.of(CourseCopilotEventType.BUILD_STARTED)).toEqual([
        {
          sessionId: 'session-1',
          type: CourseCopilotEventType.BUILD_STARTED,
          payload: { jobCount: list.length, estimateUsd: 2.5 },
        },
      ]);
    });
  });

  describe('enqueue', () => {
    it('queues the job, announces it, and starts the runner', async () => {
      const start = jest
        .spyOn(service, 'start')
        .mockImplementation(() => undefined);
      const saved = await service.enqueue(makeSession(), {
        kind: Kind.COVER_IMAGE,
        input: { title: 'Cover image' },
      });
      expect(saved).toMatchObject({
        status: Status.QUEUED,
        attempts: 0,
        dependsOn: [],
        blueprintItemId: null,
      });
      expect(
        events.of(CourseCopilotEventType.JOB_QUEUED)[0].payload,
      ).toMatchObject({
        jobId: saved.id,
        kind: Kind.COVER_IMAGE,
        title: 'Cover image',
      });
      expect(start).toHaveBeenCalledWith('session-1');
    });
  });

  // ── The run loop ─────────────────────────────────────────────────────────

  describe('run loop', () => {
    it('runs a job only after the jobs it depends on are done', async () => {
      jobs.seed(
        job('case', Kind.CASE_NEW, { dependsOn: ['rpA', 'rpB'] }),
        job('rpA', Kind.ROLEPLAY_NEW),
        job('rpB', Kind.ROLEPLAY_NEW),
        job('img', Kind.ARTICLE_IMAGE, { dependsOn: ['art'] }),
        job('art', Kind.ARTICLE),
      );

      await runToEnd();

      const { log } = executor;
      expect(log.indexOf('end:rpA')).toBeLessThan(log.indexOf('start:case'));
      expect(log.indexOf('end:rpB')).toBeLessThan(log.indexOf('start:case'));
      expect(log.indexOf('end:art')).toBeLessThan(log.indexOf('start:img'));
      expect(Object.values(statuses())).toEqual(Array(5).fill(Status.DONE));
    });

    it('never runs more jobs at once than the concurrency cap', async () => {
      build({ concurrency: 2 });
      sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
      const ids = ['q1', 'q2', 'q3', 'q4', 'q5'];
      jobs.seed(...ids.map((id) => job(id, Kind.QUIZ)));
      const release = ids.map((id) => executor.gate(id));

      service.start('session-1');
      await drain();
      expect(executor.startsOf()).toEqual(['q1', 'q2']);

      release[0]();
      await drain();
      expect(executor.startsOf()).toEqual(['q1', 'q2', 'q3']); // a slot freed → one more

      release.slice(1).forEach((fn) => fn());
      await settleRunner();
      expect(executor.maxActive).toBe(2);
      expect(executor.startsOf()).toHaveLength(5);
    });

    it('falls back to 4 at once when the configured concurrency is unusable', async () => {
      build({ concurrency: 0 });
      sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
      const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
      jobs.seed(...ids.map((id) => job(id, Kind.QUIZ)));
      const release = ids.map((id) => executor.gate(id));

      service.start('session-1');
      await drain();
      expect(executor.startsOf()).toHaveLength(4);
      release.forEach((fn) => fn());
      await settleRunner();
    });

    it('starts roleplays first, then cover and meta, then everything else', async () => {
      // Roleplays are the long pole — they have to start earliest. Concurrency
      // of 1 makes the claim order observable.
      build({ concurrency: 1 });
      sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
      jobs.seed(
        job('article', Kind.ARTICLE),
        job('quiz', Kind.QUIZ),
        job('meta', Kind.COURSE_META),
        job('cover', Kind.COVER_IMAGE),
        job('roleplay', Kind.ROLEPLAY_NEW),
        job('review', Kind.COURSE_REVIEW),
      );

      await runToEnd();

      expect(executor.startsOf()).toEqual([
        'roleplay',
        'meta',
        'cover',
        'article',
        'quiz',
        'review',
      ]);
    });

    describe('failure policy', () => {
      it('retries a validator rejection once, feeding its errors back to the specialist', async () => {
        jobs.seed(job('quiz', Kind.QUIZ));
        const errors = ['q1 has no correct answer', 'q2 repeats q1'];
        executor.plan('quiz', new SpecialistValidationError(errors), 'ok');

        await runToEnd();

        expect(jobs.byId('quiz')).toMatchObject({
          status: Status.DONE,
          attempts: 2,
        });
        expect(executor.calls).toHaveLength(2);
        expect(executor.calls[0].input.repairErrors).toBeUndefined();
        expect(executor.calls[1].input.repairErrors).toEqual(errors);
        const failed = events.of(CourseCopilotEventType.JOB_FAILED);
        expect(failed).toHaveLength(1);
        expect(failed[0].payload).toMatchObject({
          jobId: 'quiz',
          willRetry: true,
        });
        expect(failed[0].payload.error).toMatch(
          /did not pass validation: q1 has no correct answer/,
        );
      });

      it('fails the job when the repair pass is rejected too, keeping the validator error', async () => {
        jobs.seed(job('quiz', Kind.QUIZ));
        executor.plan(
          'quiz',
          new SpecialistValidationError(['first']),
          new SpecialistValidationError(['second']),
        );

        await runToEnd();

        expect(jobs.byId('quiz')).toMatchObject({
          status: Status.FAILED,
          attempts: 2,
        });
        expect(jobs.byId('quiz').error).toMatch(/second/);
      });

      it('retries a plain error as-is (no repairErrors), then succeeds', async () => {
        jobs.seed(job('article', Kind.ARTICLE));
        executor.plan('article', new Error('upstream 503'), 'ok');

        await runToEnd();

        expect(jobs.byId('article')).toMatchObject({
          status: Status.DONE,
          attempts: 2,
        });
        expect(executor.calls[1].input).not.toHaveProperty('repairErrors');
      });

      it('fails a job after two plain errors, reporting willRetry true then false', async () => {
        jobs.seed(job('article', Kind.ARTICLE));
        executor.plan('article', new Error('boom'), new Error('boom again'));

        await runToEnd();

        expect(jobs.byId('article')).toMatchObject({
          status: Status.FAILED,
          attempts: 2,
          error: 'boom again',
        });
        expect(
          events
            .of(CourseCopilotEventType.JOB_FAILED)
            .map((e) => e.payload.willRetry),
        ).toEqual([true, false]);
        expect(events.of(CourseCopilotEventType.JOB_DONE)).toHaveLength(0);
      });

      it('truncates a very long error message to 500 characters', async () => {
        jobs.seed(job('article', Kind.ARTICLE));
        const long = 'x'.repeat(900);
        executor.plan('article', new Error(long), new Error(long));

        await runToEnd();

        const stored = jobs.byId('article').error!;
        expect(stored.length).toBeLessThanOrEqual(500);
        expect(stored.endsWith('…')).toBe(true);
      });

      it('marks an environment limit SKIPPED with its reason, without retrying', async () => {
        jobs.seed(job('cover', Kind.COVER_IMAGE));
        executor.plan(
          'cover',
          new CourseCopilotJobSkip('No image provider is configured.'),
        );

        await runToEnd();

        expect(jobs.byId('cover').status).toBe(Status.SKIPPED);
        expect(jobs.byId('cover').result).toMatchObject({
          skippedReason: 'No image provider is configured.',
        });
        expect(jobs.byId('cover').error).toBeNull();
        expect(executor.calls).toHaveLength(1); // a skip is not a failure: no second attempt
        expect(
          events.of(CourseCopilotEventType.JOB_SKIPPED)[0].payload,
        ).toMatchObject({
          jobId: 'cover',
          reason: 'No image provider is configured.',
        });
        expect(events.of(CourseCopilotEventType.JOB_FAILED)).toHaveLength(0);
      });

      it('skips (not fails) jobs whose dependency did not finish, transitively, and reports the failure once', async () => {
        // `img2` is listed BEFORE `img` so it only becomes skippable on the
        // pass after `img` is — the runner must converge, not stall.
        jobs.seed(
          job('img2', Kind.ARTICLE_IMAGE, { dependsOn: ['img'] }),
          job('img', Kind.ARTICLE_IMAGE, { dependsOn: ['art'] }),
          job('art', Kind.ARTICLE),
          job('case', Kind.CASE_NEW, { dependsOn: ['rp'] }),
          job('rp', Kind.ROLEPLAY_NEW),
          job('ok', Kind.QUIZ),
        );
        executor.plan('art', new Error('a'), new Error('a2'));
        executor.plan('rp', new Error('r'), new Error('r2'));

        await runToEnd();

        expect(statuses()).toMatchObject({
          art: Status.FAILED,
          rp: Status.FAILED,
          img: Status.SKIPPED,
          img2: Status.SKIPPED,
          case: Status.SKIPPED,
          ok: Status.DONE,
        });
        expect(executor.startsOf()).not.toEqual(
          expect.arrayContaining(['img', 'img2', 'case']),
        );
        expect(jobs.byId('case').result).toEqual({
          skippedReason: 'Skipped because "rp" did not finish.',
        });
        expect(jobs.byId('img2').result).toEqual({
          skippedReason: 'Skipped because "img" did not finish.',
        });
        // Only the two jobs that actually failed are reported as failures.
        const failedIds = events
          .of(CourseCopilotEventType.JOB_FAILED)
          .map((e) => e.payload.jobId)
          .sort();
        expect(failedIds).toEqual(['art', 'art', 'rp', 'rp']);
        expect(
          events
            .of(CourseCopilotEventType.JOB_SKIPPED)
            .map((e) => e.payload.jobId)
            .sort(),
        ).toEqual(['case', 'img', 'img2']);
      });

      it('also skips a dependent when its dependency was itself skipped', async () => {
        jobs.seed(
          job('img', Kind.ARTICLE_IMAGE, { dependsOn: ['art'] }),
          job('art', Kind.ARTICLE),
        );
        executor.plan('art', new CourseCopilotJobSkip('not configured'));

        await runToEnd();

        expect(statuses()).toEqual({
          art: Status.SKIPPED,
          img: Status.SKIPPED,
        });
      });
    });

    describe('reviewer', () => {
      it('waits for everything else to settle even with free slots', async () => {
        jobs.seed(
          job('a', Kind.QUIZ),
          job('b', Kind.ARTICLE),
          job('review', Kind.COURSE_REVIEW),
        );
        const releaseA = executor.gate('a');
        const releaseB = executor.gate('b');

        service.start('session-1');
        await drain();
        expect(executor.startsOf()).toEqual(['a', 'b']); // 2 of 4 slots used

        releaseA();
        await drain();
        expect(executor.startsOf()).not.toContain('review'); // b still running

        releaseB();
        await settleRunner();
        expect(executor.startsOf()).toEqual(['a', 'b', 'review']);
        expect(executor.log.indexOf('end:b')).toBeLessThan(
          executor.log.indexOf('start:review'),
        );
      });

      it('still runs when other jobs failed or were skipped — it reviews what exists', async () => {
        jobs.seed(
          job('bad', Kind.QUIZ),
          job('skipped', Kind.ARTICLE_IMAGE, { dependsOn: ['bad'] }),
          job('review', Kind.COURSE_REVIEW),
        );
        executor.plan('bad', new Error('x'), new Error('y'));

        await runToEnd();

        expect(statuses()).toEqual({
          bad: Status.FAILED,
          skipped: Status.SKIPPED,
          review: Status.DONE,
        });
      });
    });

    describe('budget', () => {
      const budgetHold = () => events.of(CourseCopilotEventType.BUDGET_HOLD);

      it('holds every queued job and stops when the session is already over its ceiling', async () => {
        jobs.seed(job('a', Kind.QUIZ), job('b', Kind.ARTICLE));
        cost.spent.mockResolvedValue(20);

        await runToEnd(); // resolves: the runner exited rather than spinning

        expect(executor.execute).not.toHaveBeenCalled();
        expect(statuses()).toEqual({ a: Status.HELD, b: Status.HELD });
        expect(budgetHold()[0].payload).toEqual({
          state: 'held',
          spentUsd: 20,
          ceilingUsd: 15,
          jobs: 2,
        });
        // Not finished: the trainer has to raise the budget, so no hand-over.
        expect(sessions.get('session-1').status).toBe(SessionStatus.BUILDING);
        expect(events.of(CourseCopilotEventType.BUILD_FINISHED)).toHaveLength(
          0,
        );
      });

      it('lets in-flight work land, then holds the rest when spend crosses the ceiling mid-build', async () => {
        build({ concurrency: 1 });
        sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
        let spend = 0;
        cost.spent.mockImplementation(async () => spend);
        executor.onFinish('a', () => {
          spend = 20;
        });
        jobs.seed(
          job('a', Kind.ROLEPLAY_NEW),
          job('b', Kind.QUIZ),
          job('c', Kind.ARTICLE),
        );

        await runToEnd();

        expect(statuses()).toEqual({
          a: Status.DONE,
          b: Status.HELD,
          c: Status.HELD,
        });
        expect(executor.startsOf()).toEqual(['a']);
        expect(sessions.get('session-1').status).toBe(SessionStatus.BUILDING);
      });

      it('treats a ceiling of 0 as uncapped', async () => {
        sessions.seed(
          makeSession({ budgetUsd: '0.00', approvedBlueprint: emptyBlueprint }),
        );
        cost.spent.mockResolvedValue(9999);
        jobs.seed(job('a', Kind.QUIZ), job('b', Kind.ARTICLE));

        await runToEnd();

        expect(statuses()).toEqual({ a: Status.DONE, b: Status.DONE });
        expect(budgetHold()).toHaveLength(0);
      });

      it('keeps going while spend is just under the ceiling', async () => {
        cost.spent.mockResolvedValue(14.99);
        jobs.seed(job('a', Kind.QUIZ));
        await runToEnd();
        expect(statuses()).toEqual({ a: Status.DONE });
      });
    });

    describe('finishing', () => {
      it('hands the course over: EDITING, build_finished with counts, and a last structure flush', async () => {
        cost.spent.mockResolvedValue(1.23);
        jobs.seed(
          job('ok', Kind.QUIZ),
          job('bad', Kind.ARTICLE),
          job('dep', Kind.ARTICLE_IMAGE, { dependsOn: ['bad'] }),
        );
        executor.plan('bad', new Error('x'), new Error('y'));

        await runToEnd();

        const session = sessions.get('session-1');
        expect(session.status).toBe(SessionStatus.EDITING);
        expect(session.metadata?.buildCompletedAt).toEqual(expect.any(String));
        expect(flushWrite).toHaveBeenCalledWith('session-1');
        expect(events.of(CourseCopilotEventType.BUILD_FINISHED)).toEqual([
          {
            sessionId: 'session-1',
            type: CourseCopilotEventType.BUILD_FINISHED,
            payload: { done: 1, failed: 1, skipped: 1, spentUsd: 1.23 },
          },
        ]);
      });

      it('takes the per-session runner lock and releases it on exit', async () => {
        jobs.seed(job('a', Kind.QUIZ));
        await runToEnd();
        expect(redis.acquireLock).toHaveBeenCalledWith(
          'course-copilot-build:session-1',
          120,
        );
        expect(redis.releaseLock).toHaveBeenLastCalledWith(
          'course-copilot-build:session-1',
        );
      });

      it('leaves an EDITING session EDITING and does not announce a second build_finished', async () => {
        // Edit-loop jobs (a new roleplay, an image) run on a finished course.
        sessions.seed(
          makeSession({
            status: SessionStatus.EDITING,
            approvedBlueprint: emptyBlueprint,
            metadata: { buildCompletedAt: '2026-10-14T09:00:00.000Z' },
          }),
        );
        jobs.seed(job('cover', Kind.COVER_IMAGE));

        await runToEnd();

        expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
        expect(sessions.get('session-1').metadata?.buildCompletedAt).toBe(
          '2026-10-14T09:00:00.000Z', // the original completion time is kept
        );
        expect(events.of(CourseCopilotEventType.BUILD_FINISHED)).toHaveLength(
          0,
        );
        expect(flushWrite).not.toHaveBeenCalled(); // never rewrite an edited course from the blueprint
      });

      it('recovers a BUILD_FAILED session to EDITING once its retried jobs settle', async () => {
        sessions.seed(
          makeSession({
            status: SessionStatus.BUILD_FAILED,
            approvedBlueprint: emptyBlueprint,
          }),
        );
        jobs.seed(job('a', Kind.QUIZ));
        await runToEnd();
        expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
        expect(events.of(CourseCopilotEventType.BUILD_FINISHED)).toHaveLength(
          1,
        );
      });
    });

    describe('runner lifecycle', () => {
      it('joins an existing runner instead of starting a second one', async () => {
        jobs.seed(job('a', Kind.QUIZ));
        const release = executor.gate('a');
        service.start('session-1');
        service.start('session-1');
        service.start('session-1');
        await drain();
        release();
        await settleRunner();
        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(redis.acquireLock).toHaveBeenCalledTimes(1);
      });

      it('does nothing when another task already holds the build lock', async () => {
        redis.acquireLock.mockResolvedValue(false);
        jobs.seed(job('a', Kind.QUIZ));
        await runToEnd();
        expect(executor.execute).not.toHaveBeenCalled();
        expect(statuses()).toEqual({ a: Status.QUEUED });
        // A lock it never held is not its to release.
        expect(redis.releaseLock).not.toHaveBeenCalled();
      });

      it('does not start after shutdown has begun', async () => {
        jobs.seed(job('a', Kind.QUIZ));
        service.onModuleDestroy();
        service.start('session-1');
        await drain();
        expect(executor.execute).not.toHaveBeenCalled();
      });

      it('runs nothing for an archived or missing session', async () => {
        sessions.seed(makeSession({ status: SessionStatus.ARCHIVED }));
        jobs.seed(job('a', Kind.QUIZ));
        await runToEnd();
        expect(executor.execute).not.toHaveBeenCalled();

        await runToEnd('no-such-session');
      });

      it('leaves a job to the runner that claimed it first, and waits for that runner', async () => {
        // Two ECS tasks overlapping after a deploy: the claim UPDATE is what
        // keeps one job from running twice.
        jobs.seed(job('a', Kind.QUIZ));
        jobs.claim.mockImplementationOnce(async (id: string) => {
          jobs.byId(id).status = Status.RUNNING; // the other runner got it
          return null;
        });
        setTimeout(() => {
          jobs.byId('a').status = Status.DONE; // ...and finishes it
        }, 2_500);

        await runToEnd();

        expect(executor.execute).not.toHaveBeenCalled();
        expect(jobs.byId('a').status).toBe(Status.DONE);
        expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
      });

      it('keeps a running job alive with heartbeats, and stops when it ends', async () => {
        jobs.seed(job('slow', Kind.ARTICLE));
        const release = executor.gate('slow');

        service.start('session-1');
        await jest.advanceTimersByTimeAsync(
          COURSE_COPILOT_JOB_HEARTBEAT_MS * 2 + 1_000,
        );
        const whileRunning = jobs.heartbeat.mock.calls.length;
        expect(whileRunning).toBeGreaterThanOrEqual(2);
        expect(jobs.heartbeat).toHaveBeenCalledWith('slow');

        release();
        await settleRunner();
        await jest.advanceTimersByTimeAsync(
          COURSE_COPILOT_JOB_HEARTBEAT_MS * 3,
        );
        expect(jobs.heartbeat.mock.calls.length).toBe(whileRunning);
      });

      it('does not report a job done if it was reconciled away while it ran', async () => {
        jobs.seed(job('a', Kind.ARTICLE));
        executor.onFinish('a', () => {
          // reconcile() failed the job while this runner was still working.
          jobs.byId('a').status = Status.FAILED;
        });

        await runToEnd();

        expect(jobs.byId('a').status).toBe(Status.FAILED);
        expect(events.of(CourseCopilotEventType.JOB_DONE)).toHaveLength(0);
        expect(scheduleWrite).not.toHaveBeenCalled();
      });
    });

    describe('where finished work goes', () => {
      it('schedules a course rewrite after an item job during the first build', async () => {
        jobs.seed(job('art', Kind.ARTICLE));
        await runToEnd();
        expect(scheduleWrite).toHaveBeenCalledWith('session-1');
      });

      it('schedules a rewrite after an article image during the first build, but not for non-item jobs', async () => {
        jobs.seed(
          job('art', Kind.ARTICLE),
          job('img', Kind.ARTICLE_IMAGE, { dependsOn: ['art'] }),
          job('meta', Kind.COURSE_META),
          job('review', Kind.COURSE_REVIEW),
        );
        await runToEnd();
        // art + img only: meta and the review are not course items.
        expect(scheduleWrite).toHaveBeenCalledTimes(2);
      });

      it('does not rewrite the course for an edit-loop image on an existing article', async () => {
        sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
        jobs.seed(
          job('img', Kind.ARTICLE_IMAGE, {
            input: { title: 'img', articleTrackItemId: 'I-existing' },
          }),
        );
        await runToEnd();
        expect(scheduleWrite).not.toHaveBeenCalled();
      });

      describe('edit-loop placement (after the build)', () => {
        const section = () => ({
          id: 'S1',
          title: 'Listen',
          items: [
            {
              id: 'I-a',
              type: 'ARTICLE' as const,
              title: 'A',
              content: { html: '<p>a</p>' },
            },
            {
              id: 'I-b',
              type: 'JOURNAL' as const,
              title: 'B',
              content: { prompts: [] },
            },
          ],
        });
        const editing = (extra: Record<string, any> = {}) =>
          makeSession({
            status: SessionStatus.EDITING,
            approvedBlueprint: emptyBlueprint,
            metadata: { buildCompletedAt: '2026-10-14T09:00:00.000Z' },
            ...extra,
          });
        const titles = () => store.sections[0].items.map((i: any) => i.title);

        beforeEach(() => {
          build({ trackSections: [section()] });
          sessions.seed(editing());
          executor.results.set('Asha', {
            scenarioId: 77,
            summary: 'Created roleplay #77',
          });
        });

        it('inserts a new roleplay after the item it was placed behind', async () => {
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                item: bpItem({
                  id: 'rp-new',
                  type: 'ROLEPLAY',
                  title: 'Asha',
                  completionCriteria: { minScore: 55 },
                }),
                placement: { trackSectionId: 'S1', afterTrackItemId: 'I-a' },
              },
            }),
          );

          await runToEnd();

          expect(titles()).toEqual(['A', 'Asha', 'B']);
          expect(store.sections[0].items[1]).toMatchObject({
            type: 'ROLEPLAY',
            scenarioId: 77,
            completionCriteria: { minScore: 55 },
          });
          expect(
            events.of(CourseCopilotEventType.COURSE_CHANGED)[0].payload,
          ).toMatchObject({
            summary: 'Added "Asha"',
          });
          // The course is not rewritten from the blueprint: the trainer's edits stand.
          expect(scheduleWrite).not.toHaveBeenCalled();
        });

        it('appends to the section when no anchor item is given, or the anchor is gone', async () => {
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                item: bpItem({ id: 'r1', type: 'ROLEPLAY', title: 'Asha' }),
                placement: { trackSectionId: 'S1', afterTrackItemId: null },
              },
            }),
            job('Bo', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Bo',
                item: bpItem({ id: 'r2', type: 'ROLEPLAY', title: 'Bo' }),
                placement: {
                  trackSectionId: 'S1',
                  afterTrackItemId: 'deleted-in-editor',
                },
              },
            }),
          );
          executor.results.set('Bo', { scenarioId: 78 });

          await runToEnd();

          expect(titles()).toEqual(['A', 'B', 'Asha', 'Bo']);
        });

        it('replaces a roleplay in place, keeping its id, title and position', async () => {
          build({
            trackSections: [
              {
                id: 'S1',
                title: 'Listen',
                items: [
                  {
                    id: 'I-a',
                    type: 'ARTICLE',
                    title: 'A',
                    content: { html: '<p>a</p>' },
                  },
                  {
                    id: 'I-rp',
                    type: 'ROLEPLAY',
                    title: 'Asha',
                    scenarioId: 5,
                  },
                  {
                    id: 'I-b',
                    type: 'JOURNAL',
                    title: 'B',
                    content: { prompts: [] },
                  },
                ],
              },
            ],
          });
          sessions.seed(editing());
          executor.results.set('Asha', {
            scenarioId: 99,
            summary: 'Created roleplay #99',
          });
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                item: bpItem({ id: 'I-rp', type: 'ROLEPLAY', title: 'Asha' }),
                replaceTrackItemId: 'I-rp',
              },
            }),
          );

          await runToEnd();

          expect(titles()).toEqual(['A', 'Asha', 'B']);
          expect(store.sections[0].items[1]).toMatchObject({
            id: 'I-rp',
            scenarioId: 99,
          });
          expect(
            events.of(CourseCopilotEventType.COURSE_CHANGED)[0].payload,
          ).toMatchObject({
            summary: 'Regenerated "Asha"',
            itemId: 'I-rp',
          });
        });

        it('does not rewrite the course when the item it was to replace is gone', async () => {
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                item: bpItem({ id: 'x', type: 'ROLEPLAY', title: 'Asha' }),
                replaceTrackItemId: 'deleted-in-editor',
              },
            }),
          );
          const before = JSON.stringify(store.snapshot());

          await runToEnd();

          expect(JSON.stringify(store.snapshot())).toBe(before);
          expect(
            events.of(CourseCopilotEventType.JOB_FAILED).length,
          ).toBeGreaterThan(0);
        });

        // Regression (fixed 2026-10-14): regenerating a ROLEPLAY in place wipes its completion rule.
        // structure.service.ts itemFromJob() returns `completionCriteria: {}`
        // for a roleplay whose blueprint item has none (regenerate_item builds
        // one with no completionCriteria), and placeInLiveCourse() keeps it
        // with `replacement.completionCriteria ?? existing.completionCriteria`
        // (build.service.ts:488) — `{}` is not nullish, so the existing
        // minScore never survives. The comment on that block says the rule
        // "stays unless the tool asked to change" it.
        it('keeps the roleplay completion rule when the roleplay is regenerated in place', async () => {
          build({
            trackSections: [
              {
                id: 'S1',
                title: 'Listen',
                items: [
                  {
                    id: 'I-rp',
                    type: 'ROLEPLAY',
                    title: 'Asha',
                    scenarioId: 5,
                    completionCriteria: {
                      minScore: 70,
                      minDurationSeconds: 120,
                    },
                  },
                ],
              },
            ],
          });
          sessions.seed(editing());
          executor.results.set('Asha', { scenarioId: 99 });
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                // What regenerate_item enqueues: no completionCriteria on the item.
                item: bpItem({
                  id: 'I-rp',
                  type: 'ROLEPLAY',
                  title: 'Asha',
                  spec: { minScore: 70 },
                }),
                replaceTrackItemId: 'I-rp',
              },
            }),
          );

          await runToEnd();

          expect(store.item('I-rp')).toMatchObject({
            scenarioId: 99,
            completionCriteria: { minScore: 70, minDurationSeconds: 120 },
          });
        });

        // Regression (fixed 2026-10-14): a failure while placing a finished job leaves it DONE.
        // build.service.ts:413-427 settles the job DONE *before* afterDone()
        // places it in the course; if placement throws (the section was
        // deleted, or learners enrolled so the structure is locked), the catch
        // calls handleFailure(), whose requeueForRepair()/settle(FAILED) are
        // conditional on status='running' and so do nothing. Result: the job
        // shows DONE, a JOB_FAILED {willRetry:true} event is emitted that no
        // retry ever follows, and the item never reaches the course.
        it('does not leave a job DONE when its result could not be placed in the course', async () => {
          jobs.seed(
            job('Asha', Kind.ROLEPLAY_NEW, {
              input: {
                title: 'Asha',
                item: bpItem({ id: 'rp-new', type: 'ROLEPLAY', title: 'Asha' }),
                placement: {
                  trackSectionId: 'section-deleted-in-editor',
                  afterTrackItemId: null,
                },
              },
            }),
          );

          await runToEnd();

          expect(titles()).toEqual(['A', 'B']); // nothing was inserted
          expect(jobs.byId('Asha').status).not.toBe(Status.DONE);
        });
      });

      describe('a retried blueprint job after the build finished', () => {
        const blueprintWithThree = (): CourseBlueprint =>
          ({
            title: 't',
            sections: [
              {
                id: 'bp-s1',
                title: 'Listen',
                description: '',
                purpose: '',
                items: [
                  bpItem({ id: 'art', type: 'ARTICLE', title: 'Art' }),
                  bpItem({ id: 'jr', type: 'JOURNAL', title: 'Journal' }),
                  bpItem({ id: 'qz', type: 'QUIZ', title: 'Quiz' }),
                ],
              },
            ],
          }) as unknown as CourseBlueprint;

        const retried = (id: string, bpId: string, kind: Kind) =>
          job(id, kind, {
            blueprintItemId: bpId,
            input: {
              title: id,
              sectionId: 'bp-s1',
              item: blueprintWithThree().sections[0].items.find(
                (i) => i.id === bpId,
              ),
            },
          });

        const finishedSession = (map: Record<string, any>) =>
          makeSession({
            status: SessionStatus.EDITING,
            approvedBlueprint: blueprintWithThree(),
            trackIdMap: map as any,
            metadata: { buildCompletedAt: '2026-10-14T09:00:00.000Z' },
          });

        it('inserts it after the nearest earlier blueprint sibling still in the course', async () => {
          // The trainer deleted "Journal" in the editor; the quiz is retried.
          build({
            trackSections: [
              {
                id: 'S1',
                title: 'Listen',
                items: [
                  {
                    id: 'I-art',
                    type: 'ARTICLE',
                    title: 'Art',
                    content: { html: '<p>a</p>' },
                  },
                  {
                    id: 'I-extra',
                    type: 'JOURNAL',
                    title: 'Trainer added',
                    content: { prompts: [] },
                  },
                ],
              },
            ],
          });
          sessions.seed(
            finishedSession({
              sections: { 'bp-s1': 'S1' },
              items: { art: 'I-art', jr: 'I-gone' },
            }),
          );
          executor.results.set('Quiz', { content: { questions: [] } });
          jobs.seed(retried('Quiz', 'qz', Kind.QUIZ));

          await runToEnd();

          // journal's row is gone, so the quiz goes behind the article.
          expect(store.sections[0].items.map((i: any) => i.title)).toEqual([
            'Art',
            'Quiz',
            'Trainer added',
          ]);
          expect(scheduleWrite).not.toHaveBeenCalled();
          // The new row's id is recorded so a later image job can find it.
          const quizRow = store.sections[0].items[1];
          expect(sessions.get('session-1').trackIdMap.items.qz).toBe(
            quizRow.id,
          );
        });

        it('goes first when no earlier blueprint sibling is left, and recreates a missing section', async () => {
          build({
            trackSections: [
              {
                id: 'S9',
                title: 'Other',
                items: [
                  {
                    id: 'I-o',
                    type: 'JOURNAL',
                    title: 'Other item',
                    content: { prompts: [] },
                  },
                ],
              },
            ],
          });
          sessions.seed(
            finishedSession({ sections: { 'bp-s1': 'S-deleted' }, items: {} }),
          );
          executor.results.set('Art', { content: { html: '<p>x</p>' } });
          jobs.seed(retried('Art', 'art', Kind.ARTICLE));

          await runToEnd();

          expect(
            store.sections.map((s) => [
              s.title,
              s.items.map((i: any) => i.title),
            ]),
          ).toEqual([
            ['Other', ['Other item']],
            ['Listen', ['Art']],
          ]);
        });
      });
    });
  });

  // ── Trainer actions ──────────────────────────────────────────────────────

  describe('retry', () => {
    let start: jest.SpyInstance;
    beforeEach(() => {
      start = jest.spyOn(service, 'start').mockImplementation(() => undefined);
    });

    it('with no ids, requeues every failed and skipped job and leaves finished ones alone', async () => {
      jobs.seed(
        job('rp', Kind.ROLEPLAY_NEW, {
          status: Status.FAILED,
          attempts: 2,
          error: 'boom',
        }),
        job('case', Kind.CASE_NEW, {
          status: Status.SKIPPED,
          dependsOn: ['rp'],
        }),
        job('case-img', Kind.ARTICLE_IMAGE, {
          status: Status.SKIPPED,
          dependsOn: ['case'],
        }),
        job('other', Kind.QUIZ, { status: Status.SKIPPED }),
        job('done', Kind.QUIZ, { status: Status.DONE }),
      );

      await service.retry(makeSession());

      expect(statuses()).toEqual({
        rp: Status.QUEUED,
        case: Status.QUEUED,
        'case-img': Status.QUEUED,
        other: Status.QUEUED,
        done: Status.DONE,
      });
      expect(jobs.byId('rp')).toMatchObject({ attempts: 0, error: null });
      expect(start).toHaveBeenCalledWith('session-1');
    });

    it('with explicit ids, retries those plus the jobs skipped only because of them (transitively)', async () => {
      jobs.seed(
        job('rp', Kind.ROLEPLAY_NEW, { status: Status.FAILED }),
        job('case', Kind.CASE_NEW, {
          status: Status.SKIPPED,
          dependsOn: ['rp'],
        }),
        job('case-img', Kind.ARTICLE_IMAGE, {
          status: Status.SKIPPED,
          dependsOn: ['case'],
        }),
        job('other', Kind.QUIZ, { status: Status.FAILED, attempts: 2 }),
        job('unrelated', Kind.QUIZ, { status: Status.SKIPPED }),
      );

      await service.retry(makeSession(), ['rp']);

      expect(statuses()).toEqual({
        rp: Status.QUEUED,
        case: Status.QUEUED,
        'case-img': Status.QUEUED,
        other: Status.FAILED,
        unrelated: Status.SKIPPED,
      });
      expect(jobs.byId('other').attempts).toBe(2);
    });

    it('resets attempts so a retried job gets its full two tries again', async () => {
      jobs.seed(job('a', Kind.QUIZ, { status: Status.FAILED, attempts: 2 }));
      await service.retry(makeSession());
      expect(jobs.byId('a').attempts).toBe(0);
    });

    it('drops the stale repairErrors so the retry starts clean', async () => {
      jobs.seed(
        job('a', Kind.QUIZ, {
          status: Status.FAILED,
          input: { title: 'a', repairErrors: ['old'], keep: 1 },
        }),
      );
      await service.retry(makeSession());
      expect(jobs.byId('a').input).toEqual({ title: 'a', keep: 1 });
    });

    it('refuses when nothing has failed or been skipped', async () => {
      jobs.seed(job('a', Kind.QUIZ, { status: Status.DONE }));
      await expect(service.retry(makeSession())).rejects.toThrow(
        BadRequestException,
      );
      expect(start).not.toHaveBeenCalled();
    });

    it('refuses ids that are not retryable', async () => {
      jobs.seed(
        job('a', Kind.QUIZ, { status: Status.DONE }),
        job('b', Kind.QUIZ, { status: Status.FAILED }),
      );
      await expect(service.retry(makeSession(), ['a'])).rejects.toThrow(
        /Nothing to retry/,
      );
    });

    it('moves a BUILD_FAILED course session back to BUILDING', async () => {
      sessions.seed(makeSession({ status: SessionStatus.BUILD_FAILED }));
      jobs.seed(job('a', Kind.QUIZ, { status: Status.FAILED }));
      await service.retry(sessions.get('session-1'));
      expect(sessions.get('session-1').status).toBe(SessionStatus.BUILDING);
    });

    it('leaves the session status alone otherwise', async () => {
      sessions.seed(
        makeSession({
          status: SessionStatus.EDITING,
          mode: CourseCopilotMode.EDIT,
        }),
      );
      jobs.seed(job('a', Kind.QUIZ, { status: Status.FAILED }));
      await service.retry(sessions.get('session-1'));
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
    });

    it('actually reruns the job end to end', async () => {
      start.mockRestore();
      sessions.seed(
        makeSession({
          status: SessionStatus.BUILD_FAILED,
          approvedBlueprint: emptyBlueprint,
        }),
      );
      jobs.seed(job('a', Kind.QUIZ, { status: Status.FAILED, attempts: 2 }));

      await service.retry(sessions.get('session-1'));
      await settleRunner();

      expect(jobs.byId('a')).toMatchObject({
        status: Status.DONE,
        attempts: 1,
      });
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
    });
  });

  describe('cancel', () => {
    it('skips waiting and held jobs with a reason, leaves running ones, and hands the course over', async () => {
      jobs.seed(
        job('queued', Kind.QUIZ, { status: Status.QUEUED }),
        job('held', Kind.QUIZ, { status: Status.HELD }),
        job('running', Kind.ROLEPLAY_NEW, { status: Status.RUNNING }),
        job('done', Kind.QUIZ, { status: Status.DONE }),
      );
      cost.spent.mockResolvedValue(3.5);

      await service.cancel(makeSession({ status: SessionStatus.BUILDING }));

      expect(statuses()).toEqual({
        queued: Status.SKIPPED,
        held: Status.SKIPPED,
        running: Status.RUNNING,
        done: Status.DONE,
      });
      expect(jobs.byId('queued').result).toEqual({
        skippedReason: 'Cancelled.',
      });
      expect(jobs.byId('held').result).toEqual({ skippedReason: 'Cancelled.' });
      expect(jobs.byId('done').result).toBeNull();

      const session = sessions.get('session-1');
      expect(session.status).toBe(SessionStatus.EDITING);
      expect(session.metadata?.buildCompletedAt).toEqual(expect.any(String));
      expect(flushWrite).toHaveBeenCalledWith('session-1'); // what is built so far is written
      expect(events.of(CourseCopilotEventType.BUILD_FINISHED)).toEqual([
        {
          sessionId: 'session-1',
          type: CourseCopilotEventType.BUILD_FINISHED,
          payload: { cancelled: true, skipped: 2, spentUsd: 3.5 },
        },
      ]);
    });

    it('also cancels a BUILD_FAILED session', async () => {
      sessions.seed(makeSession({ status: SessionStatus.BUILD_FAILED }));
      jobs.seed(job('a', Kind.QUIZ, { status: Status.FAILED }));
      await service.cancel(sessions.get('session-1'));
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
    });

    it.each([
      SessionStatus.INTERVIEWING,
      SessionStatus.AWAITING_BLUEPRINT,
      SessionStatus.EDITING,
      SessionStatus.ARCHIVED,
    ])(
      'refuses when the session is %s — there is no build to cancel',
      async (status) => {
        await expect(service.cancel(makeSession({ status }))).rejects.toThrow(
          ConflictException,
        );
        expect(events.events).toHaveLength(0);
      },
    );

    it('stops a live runner from starting anything new', async () => {
      build({ concurrency: 1 });
      sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
      jobs.seed(
        job('a', Kind.ROLEPLAY_NEW),
        job('b', Kind.QUIZ),
        job('c', Kind.QUIZ),
      );
      const release = executor.gate('a');

      service.start('session-1');
      await drain();
      expect(executor.startsOf()).toEqual(['a']);

      await service.cancel(sessions.get('session-1'));
      release();
      await settleRunner();

      expect(executor.startsOf()).toEqual(['a']);
      expect(statuses()).toEqual({
        a: Status.DONE,
        b: Status.SKIPPED,
        c: Status.SKIPPED,
      });
    });
  });

  describe('raiseBudget', () => {
    let start: jest.SpyInstance;
    beforeEach(() => {
      start = jest.spyOn(service, 'start').mockImplementation(() => undefined);
      cost.spent.mockResolvedValue(10);
    });

    it('refuses a figure at or below what is already spent', async () => {
      // It would not release anything — the Builder contract.
      await expect(service.raiseBudget(makeSession(), 10)).rejects.toThrow(
        /not above/,
      );
      await expect(service.raiseBudget(makeSession(), 4)).rejects.toThrow(
        BadRequestException,
      );
      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('names what has been spent in the refusal', async () => {
      await expect(service.raiseBudget(makeSession(), 5)).rejects.toThrow(
        '$10.00',
      );
    });

    it.each([-1, NaN, Infinity])('refuses %s', async (value) => {
      await expect(service.raiseBudget(makeSession(), value)).rejects.toThrow(
        /budget in US dollars/,
      );
    });

    it('accepts 0 as "no cap", even when spend is above it', async () => {
      sessions.seed(makeSession({ budgetUsd: '15.00' }));
      await service.raiseBudget(sessions.get('session-1'), 0);
      expect(sessions.get('session-1').budgetUsd).toBe('0.00');
    });

    it('stores the new ceiling to the cent, releases held jobs to the queue, and restarts the runner', async () => {
      jobs.seed(
        job('held-1', Kind.QUIZ, { status: Status.HELD }),
        job('held-2', Kind.ARTICLE, { status: Status.HELD }),
        job('done', Kind.QUIZ, { status: Status.DONE }),
        job('queued', Kind.QUIZ, { status: Status.QUEUED }),
      );

      await service.raiseBudget(makeSession(), 25);

      expect(sessions.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { budgetUsd: '25.00' },
      );
      expect(statuses()).toEqual({
        'held-1': Status.QUEUED,
        'held-2': Status.QUEUED,
        done: Status.DONE,
        queued: Status.QUEUED,
      });
      expect(events.of(CourseCopilotEventType.BUDGET_HOLD)[0].payload).toEqual({
        state: 'raised',
        spentUsd: 10,
        ceilingUsd: 25,
        jobs: 2,
      });
      expect(start).toHaveBeenCalledWith('session-1');
    });

    it('does not announce or restart anything when nothing was held', async () => {
      jobs.seed(job('queued', Kind.QUIZ, { status: Status.QUEUED }));
      await service.raiseBudget(makeSession(), 25);
      expect(events.of(CourseCopilotEventType.BUDGET_HOLD)).toHaveLength(0);
      expect(start).not.toHaveBeenCalled();
    });

    it('lets a held build run to completion once the ceiling is raised', async () => {
      start.mockRestore();
      cost.spent.mockResolvedValue(20);
      jobs.seed(job('a', Kind.QUIZ), job('b', Kind.ARTICLE));
      await runToEnd();
      expect(statuses()).toEqual({ a: Status.HELD, b: Status.HELD });

      cost.spent.mockResolvedValue(20);
      await service.raiseBudget(sessions.get('session-1'), 40);
      await settleRunner();

      expect(statuses()).toEqual({ a: Status.DONE, b: Status.DONE });
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
    });
  });

  describe('reconcile', () => {
    let start: jest.SpyInstance;
    beforeEach(() => {
      start = jest.spyOn(service, 'start').mockImplementation(() => undefined);
    });

    const silentFor = (ms: number) => new Date(Date.now() - ms);
    const STALE = COURSE_COPILOT_JOB_STALE_MS;
    /** A running job orphaned by a restart, `attempts` tries in. */
    const orphan = (
      id: string,
      attempts: number,
      extra: Partial<CourseCopilotJob> = {},
    ) =>
      job(id, Kind.ROLEPLAY_NEW, {
        status: Status.RUNNING,
        attempts,
        heartbeatAt: silentFor(STALE + 60_000),
        ...extra,
      });

    it('puts a silent job that has an attempt left back in the queue, without blaming its content', async () => {
      // A restart says nothing about whether the content was bad, so the job
      // gets its remaining attempt automatically instead of waiting for a click.
      jobs.seed(orphan('stale', 1));

      await service.reconcile();

      expect(jobs.byId('stale')).toMatchObject({
        status: Status.QUEUED,
        attempts: 1, // kept: this is the last try
        error: 'Interrupted by a server restart; running it again.',
      });
      expect(
        events.of(CourseCopilotEventType.JOB_FAILED)[0].payload,
      ).toMatchObject({
        jobId: 'stale',
        willRetry: true,
      });
    });

    it('fails a silent job that has used every attempt, keeping the count so Retry still works', async () => {
      jobs.seed(orphan('stale', 2));

      await service.reconcile();

      expect(jobs.byId('stale')).toMatchObject({
        status: Status.FAILED,
        attempts: 2,
      });
      expect(jobs.byId('stale').error).toMatch(/Stopped responding/);
      expect(
        events.of(CourseCopilotEventType.JOB_FAILED)[0].payload,
      ).toMatchObject({
        jobId: 'stale',
        willRetry: false,
      });
    });

    it('leaves running jobs that are still beating alone', async () => {
      jobs.seed(
        orphan('stale', 2),
        job('alive', Kind.QUIZ, {
          status: Status.RUNNING,
          heartbeatAt: silentFor(30_000),
        }),
      );

      await service.reconcile();

      expect(statuses()).toEqual({
        stale: Status.FAILED,
        alive: Status.RUNNING,
      });
    });

    it('only judges a job stale after the stale window, not before', async () => {
      jobs.seed(
        orphan('just-inside', 2, { heartbeatAt: silentFor(STALE - 5_000) }),
        orphan('just-outside', 2, { heartbeatAt: silentFor(STALE + 5_000) }),
      );
      await service.reconcile();
      expect(statuses()).toEqual({
        'just-inside': Status.RUNNING,
        'just-outside': Status.FAILED,
      });
    });

    it('falls back to startedAt when a job never beat', async () => {
      jobs.seed(
        orphan('stale', 2, {
          heartbeatAt: null,
          startedAt: silentFor(STALE + 1_000),
        }),
      );
      await service.reconcile();
      expect(jobs.statusOf('stale')).toBe(Status.FAILED);
    });

    it('marks a BUILDING session BUILD_FAILED when its jobs died with nothing left to run', async () => {
      sessions.seed(makeSession({ status: SessionStatus.BUILDING }));
      jobs.seed(
        orphan('stale', 2),
        job('done', Kind.QUIZ, { status: Status.DONE }),
      );

      await service.reconcile();

      expect(sessions.get('session-1').status).toBe(SessionStatus.BUILD_FAILED);
      expect(events.of(CourseCopilotEventType.BUILD_FAILED)).toHaveLength(1);
      expect(start).not.toHaveBeenCalled();
    });

    it('keeps the session BUILDING and restarts the runner when a requeued job is waiting', async () => {
      sessions.seed(makeSession({ status: SessionStatus.BUILDING }));
      jobs.seed(orphan('stale', 1));

      await service.reconcile();

      expect(sessions.get('session-1').status).toBe(SessionStatus.BUILDING);
      expect(events.of(CourseCopilotEventType.BUILD_FAILED)).toHaveLength(0);
      expect(start).toHaveBeenCalledWith('session-1');
    });

    it('keeps the session BUILDING and restarts the runner when other queued work remains', async () => {
      sessions.seed(makeSession({ status: SessionStatus.BUILDING }));
      jobs.seed(
        orphan('stale', 2),
        job('next', Kind.QUIZ, { status: Status.QUEUED }),
      );

      await service.reconcile();

      expect(sessions.get('session-1').status).toBe(SessionStatus.BUILDING);
      expect(events.of(CourseCopilotEventType.BUILD_FAILED)).toHaveLength(0);
      expect(start).toHaveBeenCalledWith('session-1');
    });

    it('does not mark an EDITING session failed because an edit-loop job died', async () => {
      sessions.seed(makeSession({ status: SessionStatus.EDITING }));
      jobs.seed(orphan('stale', 2, { kind: Kind.COVER_IMAGE }));

      await service.reconcile();

      expect(jobs.statusOf('stale')).toBe(Status.FAILED);
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
      expect(events.of(CourseCopilotEventType.BUILD_FAILED)).toHaveLength(0);
    });

    it('restarts a runner for every session with queued or running work, once each', async () => {
      sessions.seed(
        makeSession({ id: 's-a' }),
        makeSession({ id: 's-b' }),
        makeSession({ id: 's-c' }),
      );
      jobs.seed(
        job('a1', Kind.QUIZ, { sessionId: 's-a', status: Status.QUEUED }),
        job('a2', Kind.QUIZ, { sessionId: 's-a', status: Status.QUEUED }),
        job('b1', Kind.QUIZ, {
          sessionId: 's-b',
          status: Status.RUNNING,
          heartbeatAt: silentFor(1_000),
        }),
        job('c1', Kind.QUIZ, { sessionId: 's-c', status: Status.DONE }),
      );

      await service.reconcile();

      expect(start.mock.calls.map((c) => c[0]).sort()).toEqual(['s-a', 's-b']);
    });

    it('does nothing when there is nothing to do', async () => {
      await service.reconcile();
      expect(start).not.toHaveBeenCalled();
      expect(events.events).toHaveLength(0);
    });

    it('a requeued orphan then runs to completion on the restarted runner', async () => {
      start.mockRestore();
      sessions.seed(makeSession({ approvedBlueprint: emptyBlueprint }));
      jobs.seed(orphan('stale', 1));

      await service.reconcile(); // requeues, and starts the runner
      await settleRunner();

      expect(jobs.byId('stale')).toMatchObject({
        status: Status.DONE,
        attempts: 2,
      });
      expect(sessions.get('session-1').status).toBe(SessionStatus.EDITING);
    });
  });
});
