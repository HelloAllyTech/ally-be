import { ConflictException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Case } from 'src/case/entity/case.entity';
import { CaseItem } from 'src/case/entity/case-item.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { TrackEnrollment } from 'src/track/entity/track-enrollment.entity';
import { TrackItemType } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS,
  COURSE_COPILOT_STRUCTURE_LOCK_PREFIX,
  COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS,
} from '../../constants/course-copilot.constants';
import {
  CourseCopilotEventType,
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../../enum/course-copilot.enum';
import { CourseBlueprint } from '../../type/course-copilot.type';
import { CourseCopilotStructureService } from '../course-copilot-structure.service';
import { item as bpItem } from '../specialists/test/specialist-test.fixtures';
import {
  FakeEventService,
  FakeJobRepository,
  FakeSessionRepository,
  FakeTrackStore,
  makeJob,
  makeSession,
} from './course-copilot-test.fixtures';

describe('CourseCopilotStructureService', () => {
  let service: CourseCopilotStructureService;
  let store: FakeTrackStore;
  let sessions: FakeSessionRepository;
  let jobs: FakeJobRepository;
  let events: FakeEventService;
  let redis: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let trackService: { upsertStructure: jest.Mock };
  let repoCounts: Map<unknown, Record<string, any>>;
  /** Who the write ran as, captured at the moment upsertStructure was called. */
  let writtenAs: (string | undefined)[];

  const build = (
    seed: ConstructorParameters<typeof FakeTrackStore>[0] = [],
  ) => {
    store = new FakeTrackStore(seed);
    sessions = new FakeSessionRepository();
    jobs = new FakeJobRepository();
    events = new FakeEventService();
    writtenAs = [];
    redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    trackService = {
      upsertStructure: jest.fn(async (trackId: string, body: any) => {
        writtenAs.push(ExecutionManager.getUserId());
        return store.upsertStructure(trackId, body);
      }),
    };
    repoCounts = new Map<unknown, Record<string, any>>([
      [
        Scenarios,
        {
          count: jest.fn().mockResolvedValue(0),
          find: jest.fn().mockResolvedValue([]),
        },
      ],
      [
        Case,
        {
          count: jest.fn().mockResolvedValue(0),
          find: jest.fn().mockResolvedValue([]),
        },
      ],
      [TrackEnrollment, { exist: jest.fn().mockResolvedValue(false) }],
    ]);
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        const repo = repoCounts.get(entity);
        if (!repo) throw new Error(`Unexpected repository ${String(entity)}`);
        return repo;
      }),
    };
    service = new CourseCopilotStructureService(
      dataSource as any,
      redis as any,
      trackService as any,
      { getTrackWithStructure: store.getTrackWithStructure } as any,
      sessions as any,
      jobs as any,
      events as any,
    );
  };

  beforeEach(() => build());

  const blueprint = (): CourseBlueprint => ({
    title: 'Staying with the texter',
    description: 'A short course.',
    estimatedDurationMinutes: 30,
    competencyIds: ['c-1'],
    cover: { mode: 'upload-later' },
    sections: [
      {
        id: 'bp-s1',
        title: 'Listen',
        description: 'Start here',
        purpose: 'Foundations',
        items: [
          bpItem({ id: 'art-1', type: 'ARTICLE', title: 'Name the feeling' }),
          bpItem({
            id: 'rp-1',
            type: 'ROLEPLAY',
            title: 'Asha goes quiet',
            completionCriteria: { minScore: 60, minDurationSeconds: 120 },
          }),
          bpItem({
            id: 'qz-1',
            type: 'QUIZ',
            title: 'Check your listening',
            completionCriteria: { passScore: 80 },
          }),
        ],
      },
      {
        id: 'bp-s2',
        title: 'Practise',
        description: '',
        purpose: 'Apply it',
        items: [
          bpItem({ id: 'jr-1', type: 'JOURNAL', title: 'Looking back' }),
          bpItem({ id: 'vd-1', type: 'VIDEO', title: 'A real call' }),
        ],
      },
      {
        id: 'bp-s3',
        title: 'Play',
        description: '',
        purpose: 'Reinforce',
        items: [bpItem({ id: 'gm-1', type: 'GAME', title: 'Sprout' })],
      },
    ],
    estimate: { usd: 1, minutes: 30, items: 6, newRoleplays: 1, images: 0 },
  });

  /** A job for blueprint item `bpId`, in the given state. */
  const itemJob = (
    bpId: string,
    kind: CourseCopilotJobKind,
    status: CourseCopilotJobStatus,
    result: Record<string, any> | null = null,
    extra: Record<string, any> = {},
  ) =>
    makeJob({
      sessionId: 'session-1',
      kind,
      blueprintItemId: bpId,
      status,
      result,
      ...extra,
    });

  const seedBuild = (extraJobs: ReturnType<typeof makeJob>[] = []) => {
    sessions.seed(
      makeSession({ approvedBlueprint: blueprint(), trackId: 'track-1' }),
    );
    jobs.seed(
      itemJob(
        'art-1',
        CourseCopilotJobKind.ARTICLE,
        CourseCopilotJobStatus.DONE,
        {
          content: { html: '<p>hi</p>' },
        },
      ),
      itemJob(
        'rp-1',
        CourseCopilotJobKind.ROLEPLAY_NEW,
        CourseCopilotJobStatus.DONE,
        {
          scenarioId: 11,
        },
      ),
      itemJob('qz-1', CourseCopilotJobKind.QUIZ, CourseCopilotJobStatus.QUEUED),
      itemJob(
        'jr-1',
        CourseCopilotJobKind.JOURNAL,
        CourseCopilotJobStatus.DONE,
        {
          content: { prompts: [{ id: 'p1', prompt: 'What stood out?' }] },
        },
      ),
      itemJob(
        'vd-1',
        CourseCopilotJobKind.VIDEO,
        CourseCopilotJobStatus.FAILED,
      ),
      itemJob(
        'gm-1',
        CourseCopilotJobKind.GAME,
        CourseCopilotJobStatus.RUNNING,
      ),
      ...extraJobs,
    );
  };

  // ── Pure helpers ─────────────────────────────────────────────────────────

  describe('renumber', () => {
    it('renumbers sections and items 1..n, whatever order they arrived with', () => {
      // The validator requires contiguous orders at both levels; tools splice
      // rows in with `order: 0` and rely on this to make the payload legal.
      const out = service.renumber([
        {
          title: 'B',
          order: 9,
          items: [
            { type: TrackItemType.JOURNAL, order: 0, title: 'j' },
            { type: TrackItemType.JOURNAL, order: 7, title: 'k' },
          ],
        },
        { title: 'A', order: 0, items: [] },
      ]);
      expect(out.map((s) => s.order)).toEqual([1, 2]);
      expect(out[0].items.map((i) => i.order)).toEqual([1, 2]);
      expect(out[0].title).toBe('B');
    });

    it('does not mutate its input and keeps every other field', () => {
      const input = [
        {
          id: 's1',
          title: 'A',
          description: 'd',
          order: 5,
          items: [
            {
              id: 'i1',
              type: TrackItemType.QUIZ,
              order: 5,
              title: 'q',
              content: { x: 1 },
            },
          ],
        },
      ];
      const out = service.renumber(input as any);
      expect(input[0].order).toBe(5);
      expect(input[0].items[0].order).toBe(5);
      expect(out[0]).toMatchObject({ id: 's1', description: 'd' });
      expect(out[0].items[0]).toMatchObject({ id: 'i1', content: { x: 1 } });
    });
  });

  describe('itemFromJob', () => {
    const jobWith = (result: Record<string, any>) =>
      makeJob({ result, status: CourseCopilotJobStatus.DONE });

    it('ROLEPLAY gets the generated scenarioId and only roleplay rules', () => {
      const dto = service.itemFromJob(
        bpItem({
          id: 'rp',
          type: 'ROLEPLAY',
          title: 'Asha',
          completionCriteria: {
            minScore: 60,
            minDurationSeconds: 90,
            passScore: 99,
          },
        }),
        jobWith({ scenarioId: 42 }),
      );
      expect(dto).toMatchObject({
        type: 'ROLEPLAY',
        title: 'Asha',
        scenarioId: 42,
        completionCriteria: { minScore: 60, minDurationSeconds: 90 },
      });
      // passScore is a quiz rule — it must not leak onto a roleplay.
      expect(dto.completionCriteria).not.toHaveProperty('passScore');
      expect(dto).not.toHaveProperty('content');
    });

    it('ROLEPLAY with no rule gets no rule, not an empty one', () => {
      // An empty object is still a value: a regenerated roleplay would
      // replace the item's real rule with it.
      const dto = service.itemFromJob(
        bpItem({ id: 'rp', type: 'ROLEPLAY' }),
        jobWith({ scenarioId: 1 }),
      );
      expect(dto.completionCriteria).toBeUndefined();
    });

    it('keeps a minScore of 0 (no gate) rather than dropping it as falsy', () => {
      const dto = service.itemFromJob(
        bpItem({
          id: 'rp',
          type: 'ROLEPLAY',
          completionCriteria: { minScore: 0 },
        }),
        jobWith({ scenarioId: 1 }),
      );
      expect(dto.completionCriteria).toEqual({ minScore: 0 });
    });

    it('CASE gets caseId and minScore only', () => {
      const dto = service.itemFromJob(
        bpItem({ id: 'c', type: 'CASE', completionCriteria: { minScore: 70 } }),
        jobWith({ caseId: 'case-1' }),
      );
      expect(dto).toMatchObject({
        caseId: 'case-1',
        completionCriteria: { minScore: 70 },
      });
      expect(
        service.itemFromJob(
          bpItem({ id: 'c', type: 'CASE' }),
          jobWith({ caseId: 'c' }),
        ).completionCriteria,
      ).toBeUndefined();
    });

    it.each(['QUIZ', 'ANNOTATED_ARTIFACT'] as const)(
      '%s carries content and its passScore',
      (type) => {
        const dto = service.itemFromJob(
          bpItem({ id: 'x', type, completionCriteria: { passScore: 80 } }),
          jobWith({ content: { questions: [] } }),
        );
        expect(dto).toMatchObject({
          content: { questions: [] },
          completionCriteria: { passScore: 80 },
        });
      },
    );

    it('QUIZ without a passScore leaves the rule to the content settings', () => {
      expect(
        service.itemFromJob(
          bpItem({ id: 'q', type: 'QUIZ' }),
          jobWith({ content: {} }),
        ).completionCriteria,
      ).toBeUndefined();
    });

    it('VIDEO defaults watchPct to 90 and honours an explicit one', () => {
      const video = bpItem({ id: 'v', type: 'VIDEO' });
      expect(
        service.itemFromJob(
          video,
          jobWith({ content: { url: 'https://x.test' } }),
        ).completionCriteria,
      ).toEqual({ watchPct: 90 });
      expect(
        service.itemFromJob(
          { ...video, completionCriteria: { watchPct: 60 } },
          jobWith({ content: {} }),
        ).completionCriteria,
      ).toEqual({ watchPct: 60 });
    });

    it('ARTICLE defaults minReadSeconds to 0 and honours an explicit one', () => {
      const article = bpItem({ id: 'a', type: 'ARTICLE' });
      expect(
        service.itemFromJob(article, jobWith({ content: { html: '<p>x</p>' } }))
          .completionCriteria,
      ).toEqual({ minReadSeconds: 0 });
      expect(
        service.itemFromJob(
          { ...article, completionCriteria: { minReadSeconds: 45 } },
          jobWith({ content: {} }),
        ).completionCriteria,
      ).toEqual({ minReadSeconds: 45 });
    });

    it.each(['JOURNAL', 'GAME'] as const)(
      '%s is content only — no completion rule',
      (type) => {
        const dto = service.itemFromJob(
          bpItem({ id: 'x', type }),
          jobWith({ content: { gameKey: 'SPROUT' } }),
        );
        expect(dto.content).toEqual({ gameKey: 'SPROUT' });
        expect(dto).not.toHaveProperty('completionCriteria');
      },
    );

    it('sets the existing id only when updating, and hasDiscussion only when the plan said', () => {
      const plain = service.itemFromJob(
        bpItem({ id: 'j', type: 'JOURNAL' }),
        jobWith({ content: {} }),
      );
      expect(plain).not.toHaveProperty('id');
      expect(plain).not.toHaveProperty('hasDiscussion');

      const updated = service.itemFromJob(
        { ...bpItem({ id: 'j', type: 'JOURNAL' }), hasDiscussion: false },
        jobWith({ content: {} }),
        'existing-id',
      );
      expect(updated).toMatchObject({
        id: 'existing-id',
        hasDiscussion: false,
      });
    });

    it('titles the row from the blueprint, not the job result', () => {
      const dto = service.itemFromJob(
        bpItem({ id: 'a', type: 'ARTICLE', title: 'Planned title' }),
        jobWith({ title: 'Ignored', content: {} }),
      );
      expect(dto.title).toBe('Planned title');
      expect(dto.order).toBe(0); // renumbered by the caller
    });
  });

  describe('sizeOf', () => {
    it('counts article words from the html, and its embedded checks', () => {
      expect(
        service.sizeOf(TrackItemType.ARTICLE, {
          html: '<p>one two&nbsp;three</p><p>four</p>',
          questions: [{}, {}],
        }),
      ).toBe('4 words · 2 checks');
      expect(
        service.sizeOf(TrackItemType.ARTICLE, { html: '<p>a b</p>' }),
      ).toBe('2 words');
      expect(
        service.sizeOf(TrackItemType.ARTICLE, {
          html: '<p>x</p>',
          questions: [{}],
        }),
      ).toBe('1 words · 1 check');
    });

    it('pluralises quiz questions, journal prompts and annotation lines/labels', () => {
      expect(service.sizeOf(TrackItemType.QUIZ, { questions: [{}] })).toBe(
        '1 question',
      );
      expect(
        service.sizeOf(TrackItemType.QUIZ, { questions: [{}, {}, {}] }),
      ).toBe('3 questions');
      expect(service.sizeOf(TrackItemType.QUIZ, undefined)).toBe('0 questions');
      expect(service.sizeOf(TrackItemType.JOURNAL, { prompts: [{}, {}] })).toBe(
        '2 prompts',
      );
      expect(
        service.sizeOf(TrackItemType.ANNOTATED_ARTIFACT, {
          units: Array.from({ length: 40 }, () => ({})),
          labels: Array.from({ length: 4 }, () => ({})),
        }),
      ).toBe('40 lines · 4 labels');
    });

    it('names the game, the video source, and the roleplay / case reference', () => {
      expect(
        service.sizeOf(TrackItemType.GAME, { gameKey: 'TREX_RUNNER' }),
      ).toBe('TREX_RUNNER');
      expect(service.sizeOf(TrackItemType.GAME, {})).toBe('game');
      expect(service.sizeOf(TrackItemType.VIDEO, { source: 'youtube' })).toBe(
        'youtube',
      );
      expect(service.sizeOf(TrackItemType.VIDEO, {})).toBe('video');
      expect(
        service.sizeOf(TrackItemType.ROLEPLAY, null, { scenarioId: 412 }),
      ).toBe('roleplay #412');
      expect(service.sizeOf(TrackItemType.ROLEPLAY, null)).toBe('roleplay');
      expect(service.sizeOf(TrackItemType.CASE, null, { caseId: 'c' })).toBe(
        'case',
      );
    });
  });

  describe('outlineForPrompt', () => {
    it('is compact: ids, types, titles, orders, sizes and rules — never content', () => {
      const outline: any = {
        trackId: 'track-1',
        title: 'Course',
        description: 'long description the model does not need',
        status: 'DRAFT',
        coverImageUrl: 'https://cdn.example.org/cover.png',
        structureLocked: true,
        sections: [
          {
            id: 's1',
            order: 1,
            title: 'Sec',
            description: 'sec description',
            items: [
              {
                id: 'i1',
                order: 1,
                type: 'ROLEPLAY',
                title: 'Asha',
                size: 'roleplay #4',
                scenarioId: 4,
                completionCriteria: { minScore: 60 },
                content: { html: 'HUGE' },
                preview: { excerpt: 'HUGE' },
              },
              {
                id: 'i2',
                order: 2,
                type: 'CASE',
                title: 'Case',
                size: 'case',
                caseId: 'case-1',
                completionCriteria: {},
              },
              {
                id: 'i3',
                order: 3,
                type: 'JOURNAL',
                title: 'J',
                size: '1 prompt',
              },
            ],
          },
        ],
      };
      const parsed = JSON.parse(service.outlineForPrompt(outline));
      expect(parsed).toEqual({
        trackId: 'track-1',
        title: 'Course',
        status: 'DRAFT',
        coverImageUrl: 'set', // the url itself is noise to the model
        structureLocked: true,
        sections: [
          {
            id: 's1',
            order: 1,
            title: 'Sec',
            items: [
              {
                id: 'i1',
                order: 1,
                type: 'ROLEPLAY',
                title: 'Asha',
                size: 'roleplay #4',
                scenarioId: 4,
                rule: { minScore: 60 },
              },
              {
                id: 'i2',
                order: 2,
                type: 'CASE',
                title: 'Case',
                size: 'case',
                caseId: 'case-1',
              },
              {
                id: 'i3',
                order: 3,
                type: 'JOURNAL',
                title: 'J',
                size: '1 prompt',
              },
            ],
          },
        ],
      });
    });

    it('reports a missing cover as null', () => {
      const parsed = JSON.parse(
        service.outlineForPrompt({
          trackId: 't',
          title: 'T',
          status: 'DRAFT',
          coverImageUrl: null,
          structureLocked: false,
          sections: [],
        } as any),
      );
      expect(parsed.coverImageUrl).toBeNull();
    });
  });

  describe('buildOutline', () => {
    it('lists items with sizes and reflects enrolment as structureLocked', async () => {
      build([
        {
          title: 'Sec',
          items: [
            { type: 'QUIZ', title: 'Q', content: { questions: [{}, {}] } },
          ],
        },
      ]);
      repoCounts.get(TrackEnrollment)!.exist!.mockResolvedValue(true);

      const outline = await service.buildOutline(
        await service.getTrack('track-1'),
      );

      expect(outline.structureLocked).toBe(true);
      expect(outline.sections[0].items[0]).toMatchObject({
        type: 'QUIZ',
        size: '2 questions',
        order: 1,
      });
      // Without `withPreview` no library lookups are made.
      expect(repoCounts.get(Scenarios)!.find).not.toHaveBeenCalled();
    });

    it('resolves roleplay / case previews and marks generated ones', async () => {
      build([
        {
          title: 'Sec',
          items: [
            { type: 'ROLEPLAY', title: 'RP', scenarioId: 5 },
            { type: 'CASE', title: 'Case', caseId: 'case-9' },
          ],
        },
      ]);
      repoCounts.get(Scenarios)!.find!.mockResolvedValue([
        {
          id: 5,
          title: 'Asha scenario',
          coverImageUrl: 'https://img.test/a.png',
        },
      ]);
      repoCounts
        .get(Case)!
        .find!.mockResolvedValue([{ id: 'case-9', title: 'Hard day' }]);
      repoCounts.set(CaseItem, {
        // caseItemCounts runs a raw grouped query through the query builder.
        createQueryBuilder: () => {
          const chain: any = {
            select: () => chain,
            addSelect: () => chain,
            where: () => chain,
            groupBy: () => chain,
            getRawMany: async () => [{ caseId: 'case-9', count: '3' }],
          };
          return chain;
        },
      } as any);

      const outline = await service.buildOutline(
        await service.getTrack('track-1'),
        {
          withPreview: true,
          generatedScenarioIds: [5],
        },
      );

      const [rp, caseItem] = outline.sections[0].items as any[];
      expect(rp.preview).toEqual({
        type: 'ROLEPLAY',
        scenarioId: 5,
        scenarioTitle: 'Asha scenario',
        coverImageUrl: 'https://img.test/a.png',
        generated: true,
      });
      expect(caseItem.preview).toEqual({
        type: 'CASE',
        caseId: 'case-9',
        caseTitle: 'Hard day',
        roleplayCount: 3,
        generated: false,
      });
    });
  });

  describe('readiness', () => {
    const readyTrack = (overrides: Record<string, any> = {}) => ({
      title: 'Course',
      description: '<p>Learn to listen.</p>',
      coverImageUrl: 'https://cdn.example.org/c.png',
      sections: [
        {
          id: 's1',
          title: 'One',
          items: [
            { id: 'i1', type: TrackItemType.ROLEPLAY, scenarioId: 3 },
            { id: 'i2', type: TrackItemType.CASE, caseId: 'case-1' },
            { id: 'i3', type: TrackItemType.JOURNAL },
          ],
        },
      ],
      ...overrides,
    });

    beforeEach(() => {
      repoCounts.get(Scenarios)!.count!.mockResolvedValue(1);
      repoCounts.get(Case)!.count!.mockResolvedValue(1);
    });

    const failing = (result: Awaited<ReturnType<typeof service.readiness>>) =>
      result.checks.filter((check) => !check.ok).map((check) => check.key);

    it('is ready when every check passes', async () => {
      const result = await service.readiness(readyTrack() as any);
      expect(result.ready).toBe(true);
      expect(result.checks.map((c) => c.key)).toEqual([
        'title',
        'description',
        'cover',
        'sections',
        'sectionItems',
        'references',
      ]);
    });

    it('flags a missing cover with how to fix it', async () => {
      const result = await service.readiness(
        readyTrack({ coverImageUrl: null }) as any,
      );
      expect(result.ready).toBe(false);
      expect(failing(result)).toEqual(['cover']);
      expect(result.checks.find((c) => c.key === 'cover')!.detail).toMatch(
        /Cover image needed/,
      );
    });

    it('treats a markup-only description as empty', async () => {
      const result = await service.readiness(
        readyTrack({ description: '<p>&nbsp;</p>' }) as any,
      );
      expect(failing(result)).toEqual(['description']);
    });

    it('names empty sections in the detail', async () => {
      const track = readyTrack();
      track.sections.push({ id: 's2', title: 'Nothing yet', items: [] });
      const result = await service.readiness(track as any);
      expect(failing(result)).toEqual(['sectionItems']);
      expect(result.checks.find((c) => c.key === 'sectionItems')!.detail).toBe(
        'Empty: "Nothing yet"',
      );
    });

    it('fails sections and sectionItems on a course with no sections', async () => {
      const result = await service.readiness(
        readyTrack({ sections: [] }) as any,
      );
      expect(failing(result)).toEqual(['sections', 'sectionItems']);
    });

    it('fails references when a roleplay or case is not active', async () => {
      repoCounts.get(Scenarios)!.count!.mockResolvedValue(0); // the roleplay is unpublished
      const result = await service.readiness(readyTrack() as any);
      expect(failing(result)).toEqual(['references']);
      expect(result.checks.find((c) => c.key === 'references')!.detail).toMatch(
        /not active/,
      );
    });

    it('counts distinct references: two items on one roleplay need one active row', async () => {
      const track = readyTrack();
      track.sections[0].items.push({
        id: 'i4',
        type: TrackItemType.ROLEPLAY,
        scenarioId: 3,
      });
      const result = await service.readiness(track as any);
      expect(result.checks.find((c) => c.key === 'references')!.ok).toBe(true);
    });

    it('does not query the library when nothing references it', async () => {
      const track = readyTrack();
      track.sections = [
        {
          id: 's1',
          title: 'One',
          items: [{ id: 'i', type: TrackItemType.JOURNAL }],
        },
      ] as any;
      const result = await service.readiness(track as any);
      expect(result.ready).toBe(true);
      expect(repoCounts.get(Scenarios)!.count).not.toHaveBeenCalled();
      expect(repoCounts.get(Case)!.count).not.toHaveBeenCalled();
    });
  });

  // ── Locked writes ────────────────────────────────────────────────────────

  describe('mutate', () => {
    beforeEach(() =>
      build([
        {
          title: 'Sec 1',
          items: [
            { type: 'ARTICLE', title: 'First', content: { html: '<p>a</p>' } },
            { type: 'JOURNAL', title: 'Second', content: { prompts: [] } },
          ],
        },
      ]),
    );

    const session = () => makeSession({ trackId: 'track-1', createdBy: 7 });

    it('refuses a session with no course yet', async () => {
      await expect(
        service.mutate(makeSession({ trackId: null }), () => undefined),
      ).rejects.toThrow(ConflictException);
      expect(redis.acquireLock).not.toHaveBeenCalled();
    });

    it('renumbers what the callback spliced in before saving', async () => {
      // The fake course, like the real validator, rejects non-contiguous
      // orders — so this only passes if mutate renumbers.
      await service.mutate(session(), (sections) => {
        sections[0].items.splice(1, 0, {
          type: TrackItemType.JOURNAL,
          order: 0,
          title: 'Inserted',
        } as any);
      });

      expect(
        store.sections[0].items.map((i: any) => [i.title, i.order]),
      ).toEqual([
        ['First', 1],
        ['Inserted', 2],
        ['Second', 3],
      ]);
    });

    it('returns the callback result and the course as saved, with server-assigned ids', async () => {
      const { result, track } = await service.mutate(session(), (sections) => {
        sections[0].items.push({
          type: TrackItemType.JOURNAL,
          order: 0,
          title: 'New row',
        } as any);
        return 'done';
      });
      expect(result).toBe('done');
      const created = track.sections[0].items.find(
        (i) => i.title === 'New row',
      )!;
      expect(created.id).toBeTruthy();
    });

    it('re-reads the course every time, so an editor change between turns is kept', async () => {
      await service.mutate(session(), () => undefined);
      // The trainer retitles an item in the editor between two copilot turns.
      store.item(store.itemIds()[0]).title = 'Edited in the editor';

      let seenTitle = '';
      await service.mutate(session(), (sections) => {
        seenTitle = sections[0].items[0].title;
      });

      expect(seenTitle).toBe('Edited in the editor');
      expect(store.item(store.itemIds()[0]).title).toBe('Edited in the editor');
    });

    it('saves as the session owner, not as whoever happens to be in context', async () => {
      await service.mutate(session(), () => undefined);
      expect(writtenAs).toEqual(['7']);
    });

    it('takes the per-session lock and releases it afterwards', async () => {
      await service.mutate(session(), () => undefined);
      expect(redis.acquireLock).toHaveBeenCalledWith(
        `${COURSE_COPILOT_STRUCTURE_LOCK_PREFIX}:session-1`,
        COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS,
      );
      expect(redis.releaseLock).toHaveBeenCalledWith(
        `${COURSE_COPILOT_STRUCTURE_LOCK_PREFIX}:session-1`,
      );
    });

    it('releases the lock and saves nothing when the callback throws', async () => {
      await expect(
        service.mutate(session(), () => {
          throw new Error('bad edit');
        }),
      ).rejects.toThrow('bad edit');
      expect(redis.releaseLock).toHaveBeenCalledTimes(1);
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('lets a structure-locked ConflictException from the save reach the caller', async () => {
      trackService.upsertStructure.mockRejectedValueOnce(
        new ConflictException(
          'Learners are enrolled in this track, so its structure is locked.',
        ),
      );
      await expect(service.mutate(session(), () => undefined)).rejects.toThrow(
        /locked/,
      );
      expect(redis.releaseLock).toHaveBeenCalled();
    });
  });

  describe('withLock', () => {
    afterEach(() => jest.useRealTimers());

    it('retries until the lock is granted, then runs once', async () => {
      jest.useFakeTimers();
      redis.acquireLock
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const fn = jest.fn().mockResolvedValue('ran');

      const pending = service.withLock('session-1', fn);
      await jest.advanceTimersByTimeAsync(500); // two 250ms back-offs

      await expect(pending).resolves.toBe('ran');
      expect(redis.acquireLock).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(redis.releaseLock).toHaveBeenCalledTimes(1);
    });

    it('does not run the callback until the lock is held', async () => {
      jest.useFakeTimers();
      redis.acquireLock.mockResolvedValueOnce(false).mockResolvedValue(true);
      const fn = jest.fn().mockResolvedValue(undefined);

      const pending = service.withLock('session-1', fn);
      await jest.advanceTimersByTimeAsync(100);
      expect(fn).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(200);
      await pending;
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('gives up with a ConflictException after the deadline, without releasing a lock it never held', async () => {
      jest.useFakeTimers();
      redis.acquireLock.mockResolvedValue(false);
      const fn = jest.fn();

      const pending = service.withLock('session-1', fn);
      const assertion = expect(pending).rejects.toThrow(ConflictException);
      await jest.advanceTimersByTimeAsync(46_000);

      await assertion;
      await expect(pending).rejects.toThrow(/still being saved/);
      expect(fn).not.toHaveBeenCalled();
      expect(redis.releaseLock).not.toHaveBeenCalled();
    });

    it('swallows a failing release so the caller still gets its result', async () => {
      redis.releaseLock.mockRejectedValue(new Error('redis down'));
      await expect(
        service.withLock('session-1', async () => 'ok'),
      ).resolves.toBe('ok');
    });
  });

  describe('asOwner', () => {
    it('runs with the session creator as the execution user', async () => {
      const seen = await service.asOwner(
        makeSession({ createdBy: 42, tenantId: 'tenant-9' }),
        async () => [
          ExecutionManager.getUserId(),
          ExecutionManager.getTenantId(),
        ],
      );
      expect(seen).toEqual(['42', 'tenant-9']);
    });

    it('leaves an existing request context alone', async () => {
      const seen = await ExecutionManager.runWithContext(async () => {
        ExecutionManager.setAuthContext('1', 'tenant-1');
        return service.asOwner(makeSession({ createdBy: 42 }), async () =>
          ExecutionManager.getUserId(),
        );
      });
      expect(seen).toBe('1');
    });
  });

  // ── Build writes ─────────────────────────────────────────────────────────

  describe('writeBuildStructure', () => {
    it('does nothing for a session with no approved blueprint or no course', async () => {
      sessions.seed(makeSession({ id: 'a', approvedBlueprint: null }));
      sessions.seed(
        makeSession({ id: 'b', approvedBlueprint: blueprint(), trackId: null }),
      );
      await service.writeBuildStructure('a');
      await service.writeBuildStructure('b');
      await service.writeBuildStructure('missing');
      expect(redis.acquireLock).not.toHaveBeenCalled();
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('writes only items whose job is DONE, in blueprint order, omitting empty sections', async () => {
      seedBuild();

      await service.writeBuildStructure('session-1');

      // qz-1 is queued, vd-1 failed, gm-1 still running: none of them are
      // written, and "Play" has nothing done so it is not written either.
      expect(
        store.sections.map((s) => [s.title, s.items.map((i: any) => i.title)]),
      ).toEqual([
        ['Listen', ['Name the feeling', 'Asha goes quiet']],
        ['Practise', ['Looking back']],
      ]);
      expect(store.sections.map((s) => s.order)).toEqual([1, 2]);
      expect(store.sections[0].description).toBe('Start here');
      // Blank blueprint descriptions are written as absent, not as "".
      expect(store.sections[1].description).toBeNull();
    });

    it('writes items in blueprint order however the jobs finished', async () => {
      sessions.seed(makeSession({ approvedBlueprint: blueprint() }));
      // Finished in the reverse of blueprint order, listed in that order too.
      jobs.seed(
        itemJob(
          'qz-1',
          CourseCopilotJobKind.QUIZ,
          CourseCopilotJobStatus.DONE,
          { content: { questions: [] } },
        ),
        itemJob(
          'rp-1',
          CourseCopilotJobKind.ROLEPLAY_NEW,
          CourseCopilotJobStatus.DONE,
          { scenarioId: 3 },
        ),
        itemJob(
          'art-1',
          CourseCopilotJobKind.ARTICLE,
          CourseCopilotJobStatus.DONE,
          { content: { html: '' } },
        ),
      );
      await service.writeBuildStructure('session-1');
      expect(store.sections[0].items.map((i: any) => i.title)).toEqual([
        'Name the feeling',
        'Asha goes quiet',
        'Check your listening',
      ]);
    });

    it('maps each blueprint item to the right content and rule', async () => {
      seedBuild();
      await service.writeBuildStructure('session-1');
      const [article, roleplay] = store.sections[0].items;
      expect(article).toMatchObject({
        type: 'ARTICLE',
        content: { html: '<p>hi</p>' },
        completionCriteria: { minReadSeconds: 0 },
      });
      expect(roleplay).toMatchObject({
        type: 'ROLEPLAY',
        scenarioId: 11,
        completionCriteria: { minScore: 60, minDurationSeconds: 120 },
      });
    });

    it('ignores image jobs, edit-loop placements and in-place replacements', async () => {
      seedBuild([
        itemJob(
          'art-1',
          CourseCopilotJobKind.ARTICLE_IMAGE,
          CourseCopilotJobStatus.DONE,
          {
            imageUrl: 'https://img.test/x.png',
          },
        ),
        // An edit-mode job for the same blueprint id must not displace the
        // original item's job.
        itemJob(
          'qz-1',
          CourseCopilotJobKind.QUIZ,
          CourseCopilotJobStatus.DONE,
          { content: {} },
          {
            input: { placement: { trackSectionId: 'x' } },
          },
        ),
        itemJob(
          'gm-1',
          CourseCopilotJobKind.GAME,
          CourseCopilotJobStatus.DONE,
          { content: {} },
          {
            input: { replaceTrackItemId: 'y' },
          },
        ),
      ]);
      await service.writeBuildStructure('session-1');
      const titles = store.sections.flatMap((s) =>
        s.items.map((i: any) => i.title),
      );
      expect(titles).toEqual([
        'Name the feeling',
        'Asha goes quiet',
        'Looking back',
      ]);
    });

    it('reads server-assigned ids back by position into trackIdMap', async () => {
      seedBuild();

      await service.writeBuildStructure('session-1');

      const map = sessions.get('session-1').trackIdMap;
      expect(map.sections).toEqual({
        'bp-s1': store.sections[0].id,
        'bp-s2': store.sections[1].id,
      });
      expect(map.items).toEqual({
        'art-1': store.sections[0].items[0].id,
        'rp-1': store.sections[0].items[1].id,
        'jr-1': store.sections[1].items[0].id,
      });
    });

    it('updates the same rows on the next write instead of recreating them', async () => {
      // Learner progress rows point at item ids: a later write must be an
      // update of the same rows, never soft-delete + recreate.
      seedBuild();
      await service.writeBuildStructure('session-1');
      const firstIds = new Map(
        store.sections.flatMap((s) => s.items.map((i: any) => [i.title, i.id])),
      );
      const firstSectionId = store.sections[0].id;

      jobs.byId(
        jobs.rows.find((j) => j.blueprintItemId === 'qz-1')!.id,
      ).status = CourseCopilotJobStatus.DONE;
      jobs.rows.find((j) => j.blueprintItemId === 'qz-1')!.result = {
        content: { questions: [] },
      };
      await service.writeBuildStructure('session-1');

      expect(store.sections[0].id).toBe(firstSectionId);
      for (const section of store.sections) {
        for (const row of section.items) {
          if (firstIds.has(row.title))
            expect(row.id).toBe(firstIds.get(row.title));
        }
      }
      // The new quiz landed after the roleplay, and was mapped for next time.
      expect(store.sections[0].items.map((i: any) => i.title)).toEqual([
        'Name the feeling',
        'Asha goes quiet',
        'Check your listening',
      ]);
      expect(sessions.get('session-1').trackIdMap.items['qz-1']).toBe(
        store.sections[0].items[2].id,
      );
    });

    it('keeps items and sections the trainer added in the editor mid-build', async () => {
      seedBuild();
      await service.writeBuildStructure('session-1');
      const sectionId = store.sections[0].id;
      // Editor: a new item in a mapped section, plus a brand new section.
      store.sections[0].items.push({
        id: 'editor-item',
        sectionId,
        type: 'ARTICLE',
        order: 3,
        title: 'Trainer wrote this',
        description: null,
        scenarioId: null,
        caseId: null,
        content: { html: '<p>mine</p>' },
        completionCriteria: null,
        hasDiscussion: false,
      });
      store.sections.push({
        id: 'editor-section',
        trackId: 'track-1',
        title: 'Trainer section',
        description: null,
        order: 3,
        items: [
          {
            id: 'editor-item-2',
            sectionId: 'editor-section',
            type: 'JOURNAL',
            order: 1,
            title: 'Reflect',
            description: null,
            scenarioId: null,
            caseId: null,
            content: { prompts: [] },
            completionCriteria: null,
            hasDiscussion: false,
          },
        ],
      });
      // More build output arrives.
      const quiz = jobs.rows.find((j) => j.blueprintItemId === 'qz-1')!;
      quiz.status = CourseCopilotJobStatus.DONE;
      quiz.result = { content: { questions: [] } };

      await service.writeBuildStructure('session-1');

      expect(
        store.sections.map((s) => [s.title, s.items.map((i: any) => i.title)]),
      ).toEqual([
        // Blueprint items first (in blueprint order), the trainer's after.
        [
          'Listen',
          [
            'Name the feeling',
            'Asha goes quiet',
            'Check your listening',
            'Trainer wrote this',
          ],
        ],
        ['Practise', ['Looking back']],
        ['Trainer section', ['Reflect']],
      ]);
      // Same rows, not copies: ids survive.
      expect(store.item('editor-item')).toBeDefined();
      expect(store.item('editor-item-2')).toBeDefined();
      // And they were not adopted into the blueprint map.
      expect(
        Object.values(sessions.get('session-1').trackIdMap.items),
      ).not.toContain('editor-item');
    });

    it('records one structure_written event with the saved counts', async () => {
      seedBuild();
      await service.writeBuildStructure('session-1');
      expect(events.of(CourseCopilotEventType.STRUCTURE_WRITTEN)).toEqual([
        {
          sessionId: 'session-1',
          type: CourseCopilotEventType.STRUCTURE_WRITTEN,
          payload: { sections: 2, items: 3 },
        },
      ]);
    });

    it('saves as the session owner and under the structure lock', async () => {
      seedBuild();
      await service.writeBuildStructure('session-1');
      expect(writtenAs).toEqual(['7']);
      expect(redis.acquireLock).toHaveBeenCalledWith(
        'course-copilot-structure:session-1',
        COURSE_COPILOT_STRUCTURE_LOCK_TTL_SECONDS,
      );
      expect(redis.releaseLock).toHaveBeenCalled();
    });

    it('writes nothing when no item is done yet', async () => {
      sessions.seed(makeSession({ approvedBlueprint: blueprint() }));
      jobs.seed(
        itemJob(
          'art-1',
          CourseCopilotJobKind.ARTICLE,
          CourseCopilotJobStatus.QUEUED,
        ),
      );
      await service.writeBuildStructure('session-1');
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
      expect(events.types()).toEqual([]);
    });

    it('does not run again if the course was bound away mid-flight', async () => {
      // The session row is re-read under the lock; a duplicate_course switch
      // between the two reads must not write to the old course.
      seedBuild();
      const realFindOne = sessions.findOne.getMockImplementation()!;
      let call = 0;
      sessions.findOne.mockImplementation(async (options) => {
        call += 1;
        const row = await realFindOne(options);
        return call === 2 && row ? { ...row, trackId: null } : row;
      });
      await service.writeBuildStructure('session-1');
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });
  });

  describe('scheduleBuildWrite / flushBuildWrite', () => {
    let write: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      write = jest
        .spyOn(service, 'writeBuildStructure')
        .mockResolvedValue(undefined);
    });
    afterEach(() => jest.useRealTimers());

    it('coalesces results that land inside the debounce window into one save', async () => {
      service.scheduleBuildWrite('session-1');
      await jest.advanceTimersByTimeAsync(
        COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS - 500,
      );
      service.scheduleBuildWrite('session-1');
      service.scheduleBuildWrite('session-1');
      expect(write).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS);
      expect(write).toHaveBeenCalledTimes(1);
    });

    it('schedules exactly one more write for requests that arrive during a save', async () => {
      let release!: () => void;
      write.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );

      service.scheduleBuildWrite('session-1');
      await jest.advanceTimersByTimeAsync(COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS);
      expect(write).toHaveBeenCalledTimes(1);

      // Two results land while the first save is still running.
      service.scheduleBuildWrite('session-1');
      service.scheduleBuildWrite('session-1');
      release();
      await jest.advanceTimersByTimeAsync(COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS);

      expect(write).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(
        COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS * 3,
      );
      expect(write).toHaveBeenCalledTimes(2);
    });

    it('flush cancels the pending timer and writes straight away, once', async () => {
      service.scheduleBuildWrite('session-1');
      await service.flushBuildWrite('session-1');
      expect(write).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(
        COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS * 2,
      );
      expect(write).toHaveBeenCalledTimes(1);
    });

    it('flush waits for a save already running before writing the latest results', async () => {
      const order: string[] = [];
      let release!: () => void;
      write.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => (release = resolve));
        order.push('first-done');
      });
      write.mockImplementationOnce(async () => {
        order.push('second');
      });

      service.scheduleBuildWrite('session-1');
      await jest.advanceTimersByTimeAsync(COURSE_COPILOT_STRUCTURE_DEBOUNCE_MS);
      const flushed = service.flushBuildWrite('session-1');
      await jest.advanceTimersByTimeAsync(0);
      expect(order).toEqual([]); // still waiting on the in-flight write
      release();
      await flushed;

      expect(order).toEqual(['first-done', 'second']);
    });
  });
});
