import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Case } from 'src/case/entity/case.entity';
import { CaseItem } from 'src/case/entity/case-item.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { TrackEnrollment } from 'src/track/entity/track-enrollment.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../../enum/course-copilot.enum';
import { CourseCopilotEditToolsService } from '../course-copilot-edit-tools.service';
import { CourseCopilotStructureService } from '../course-copilot-structure.service';
import { SpecialistValidationError } from '../specialists/specialist.types';
import type { CourseCopilotToolContext } from '../course-copilot-tools.service';
import {
  FakeEventService,
  FakeJobRepository,
  FakeSessionRepository,
  FakeTrackStore,
  makeSession,
} from './course-copilot-test.fixtures';

const LOCKED =
  'Learners are enrolled in this track, so its structure is locked. Duplicate the track to restructure it.';

/** A course with one of every kind of item, an empty section, and real-looking ids. */
const courseSeed = () => [
  {
    id: 'S1',
    title: 'Listen',
    items: [
      {
        id: 'I-art',
        type: 'ARTICLE' as const,
        title: 'Name the feeling',
        content: { html: '<p>hello world</p>' },
      },
      {
        id: 'I-rp',
        type: 'ROLEPLAY' as const,
        title: 'Asha',
        scenarioId: 5,
        completionCriteria: { minScore: 50, minDurationSeconds: 30 },
      },
      {
        id: 'I-qz',
        type: 'QUIZ' as const,
        title: 'Check',
        content: {
          questions: [{ id: 'q1' }],
          settings: { passScore: 60, shuffle: true },
        },
        completionCriteria: { passScore: 60 },
      },
      {
        id: 'I-vd',
        type: 'VIDEO' as const,
        title: 'Clip',
        content: { source: 'youtube', url: 'https://youtu.be/x' },
        completionCriteria: { watchPct: 90 },
      },
      {
        id: 'I-gm',
        type: 'GAME' as const,
        title: 'Play',
        content: { gameKey: 'TREX_RUNNER' },
      },
      {
        id: 'I-cs',
        type: 'CASE' as const,
        title: 'The case',
        caseId: 'case-1',
      },
      {
        id: 'I-an',
        type: 'ANNOTATED_ARTIFACT' as const,
        title: 'Annotate',
        content: { units: [], labels: [], settings: { passScore: 70 } },
        completionCriteria: { passScore: 70 },
      },
    ],
  },
  {
    id: 'S2',
    title: 'Practise',
    items: [
      {
        id: 'I-jr',
        type: 'JOURNAL' as const,
        title: 'Journal',
        content: { prompts: [] },
      },
    ],
  },
  { id: 'S3', title: 'Empty so far', items: [] },
];

describe('CourseCopilotEditToolsService', () => {
  let service: CourseCopilotEditToolsService;
  let store: FakeTrackStore;
  let session: ReturnType<typeof makeSession>;
  /** What the session row holds — a new turn reloads the session from here. */
  let dbMetadata: Record<string, any>;
  let trackService: {
    upsertStructure: jest.Mock;
    updateTrack: jest.Mock;
    duplicateTrack: jest.Mock;
  };
  let trackTenantService: { assignTracksToTenant: jest.Mock };
  let sessionService: { appendChangeLog: jest.Mock; patchMetadata: jest.Mock };
  let sessionRepository: FakeSessionRepository;
  let buildService: { enqueue: jest.Mock };
  let library: { getActiveScenarios: jest.Mock; getActiveCase: jest.Mock };
  let executor: { specialistContext: jest.Mock };
  let specialists: Record<
    'article' | 'quiz' | 'journal' | 'annotation',
    { generate: jest.Mock }
  >;
  let tenantRows: { id: string; name: string }[];
  let ranAs: (string | undefined)[];

  const build = (seed: ReturnType<typeof courseSeed> = courseSeed()) => {
    store = new FakeTrackStore(seed as any);
    session = makeSession({
      status: CourseCopilotSessionStatus.EDITING,
      mode: CourseCopilotMode.EDIT,
      trackId: 'track-1',
    });
    dbMetadata = {};
    ranAs = [];
    tenantRows = [
      { id: 't1', name: 'Acme' },
      { id: 't2', name: 'Beta Org' },
      { id: 't3', name: 'Gamma' },
    ];

    const redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const refs = new Map<unknown, any>([
      [
        Scenarios,
        {
          count: jest.fn().mockResolvedValue(1),
          find: jest.fn().mockResolvedValue([]),
        },
      ],
      [
        Case,
        {
          count: jest.fn().mockResolvedValue(1),
          find: jest.fn().mockResolvedValue([]),
        },
      ],
      [TrackEnrollment, { exist: jest.fn().mockResolvedValue(false) }],
      [
        CaseItem,
        {
          createQueryBuilder: () => {
            const chain: any = {
              select: () => chain,
              addSelect: () => chain,
              where: () => chain,
              groupBy: () => chain,
              getRawMany: async () => [],
            };
            return chain;
          },
        },
      ],
      [
        Tenant,
        {
          // `find({ where: { id: In([...]) } })` — In() exposes its list as `.value`.
          find: jest.fn(async (options: any) => {
            const wanted: string[] | undefined = options?.where?.id?.value;
            return tenantRows.filter(
              (tenant) => !wanted || wanted.includes(tenant.id),
            );
          }),
        },
      ],
    ]);
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => refs.get(entity)),
    };

    sessionRepository = new FakeSessionRepository();
    sessionRepository.seed(session);
    trackService = {
      upsertStructure: jest.fn((trackId: string, body: any) =>
        store.upsertStructure(trackId, body),
      ),
      updateTrack: jest.fn(async (_id: string, patch: Record<string, any>) => {
        ranAs.push(ExecutionManager.getUserId());
        Object.assign(store.track, patch);
      }),
      duplicateTrack: jest.fn(async () => ({
        id: 'track-copy',
        title: 'Copy of Staying with the texter',
      })),
    };
    trackTenantService = {
      assignTracksToTenant: jest.fn().mockResolvedValue(undefined),
    };
    sessionService = {
      appendChangeLog: jest.fn(async (_id: string, entry: any) => ({
        at: 'now',
        ...entry,
      })),
      patchMetadata: jest.fn(
        async (_id: string, patch: Record<string, any>) => {
          dbMetadata = { ...dbMetadata, ...patch };
        },
      ),
    };
    buildService = {
      enqueue: jest.fn(async (_s: any, job: any) => ({ id: 'job-1', ...job })),
    };
    library = {
      getActiveScenarios: jest.fn(async (ids: number[]) =>
        ids
          .filter((id) => id === 5 || id === 6)
          .map((id) => ({ id, title: `Roleplay ${id}` })),
      ),
      getActiveCase: jest.fn(async (id: string) =>
        id === 'case-1' ? { id, title: 'The case' } : null,
      ),
    };
    executor = {
      specialistContext: jest.fn(async (_s: any, job: any, usage: any) => ({
        job,
        usage,
      })),
    };
    specialists = {
      article: { generate: jest.fn() },
      quiz: { generate: jest.fn() },
      journal: { generate: jest.fn() },
      annotation: { generate: jest.fn() },
    };

    const structure = new CourseCopilotStructureService(
      dataSource as any,
      redis as any,
      trackService as any,
      { getTrackWithStructure: store.getTrackWithStructure } as any,
      sessionRepository as any,
      new FakeJobRepository() as any,
      new FakeEventService() as any,
    );
    service = new CourseCopilotEditToolsService(
      dataSource as any,
      sessionRepository as any,
      trackService as any,
      trackTenantService as any,
      {} as any,
      structure,
      sessionService as any,
      library as any,
      buildService as any,
      executor as any,
      specialists.article as any,
      specialists.quiz as any,
      specialists.journal as any,
      specialists.annotation as any,
    );
  };

  beforeEach(() => build());

  const run = (
    name: string,
    input: Record<string, any> = {},
    answer?: CourseCopilotToolContext['answer'],
  ) =>
    service.execute(name, input, {
      session,
      userId: 7,
      ...(answer ? { answer } : {}),
    });

  /** The next turn: the session is reloaded from what was persisted. */
  const nextTurn = () => {
    session = makeSession({
      status: CourseCopilotSessionStatus.EDITING,
      mode: CourseCopilotMode.EDIT,
      trackId: 'track-1',
      metadata: JSON.parse(JSON.stringify(dbMetadata)),
    });
  };

  const titles = (sectionIndex = 0) =>
    store.sections[sectionIndex].items.map((i: any) => i.title);
  const frame = (outcome: any, name: string) =>
    outcome.events?.find((e: any) => e.event === name);
  const questionOf = (outcome: any) => frame(outcome, 'question').data;

  /**
   * Run a tool that must be refused. Today a refusal raised inside a tool
   * escapes execute() as a thrown error (the bug, since fixed, described under "error
   * mapping"); by design it is an `ok:false` outcome. Both mean "the change
   * was refused with this message", which is what these tests pin.
   */
  const refused = async (name: string, input: Record<string, any>) => {
    try {
      return { ...(await run(name, input)).modelResult } as Record<string, any>;
    } catch (error) {
      return {
        ok: false,
        error: 'thrown',
        message: (error as Error).message,
      } as Record<string, any>;
    }
  };

  // ── Guards ───────────────────────────────────────────────────────────────

  describe('guards', () => {
    it('refuses every tool when the session has no course', async () => {
      const outcome = await service.execute(
        'get_course_outline',
        {},
        { session: makeSession({ trackId: null }), userId: 7 },
      );
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'no_course',
      });
    });

    it('refuses a tool it does not know', async () => {
      expect((await run('summon_dragon')).modelResult).toMatchObject({
        ok: false,
        error: 'unknown_tool',
      });
    });

    it('names the ids that exist when the model guesses an id', async () => {
      const result = await refused('remove_item', { itemId: 'made-up' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(
        /No item with id made-up.*<course_outline>/,
      );
    });
  });

  // Regression (fixed 2026-10-14): execute() never maps a tool's failure. Every branch of its switch is
  // `return this.someTool(...)` inside `try { … } catch (error) { return
  // this.failure(name, error) }` — returning the promise WITHOUT awaiting it
  // means a rejection skips the catch, so failure() is dead code for every
  // async tool (edit-tools.service.ts:329-377). A locked course, a rejected
  // generation, a not-found id and a validator error all escape as thrown
  // errors; the orchestrator's catch-all then hands the model a generic
  // `tool_failed` + the raw message, so the model never sees `structure_locked`
  // (and its "offer duplicate_course" guidance), `generation_failed` or the
  // repairable `invalid`. The fix is `return await this.someTool(...)`.
  //
  // The tests below pin the intended mapping and are skipped until then. The
  // refusal tests elsewhere in this file go through `refused()`, which accepts
  // either surface, so they pin "refused, nothing written" regardless.
  describe('error mapping', () => {
    // Regression: see the block comment above.
    it('turns a structure-locked ConflictException from the save into structure_locked', async () => {
      // Learners are enrolled; the real TrackService throws a 409 that says so.
      trackService.upsertStructure.mockRejectedValueOnce(
        new ConflictException(LOCKED),
      );

      const outcome = await run('add_item', {
        sectionId: 'S3',
        type: 'GAME',
        title: 'A break',
        spec: { gameKey: 'TREX_RUNNER' },
      });

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'structure_locked',
      });
      // The model is told what to offer instead.
      expect(outcome.modelResult.message).toMatch(/duplicate_course/);
      expect(outcome.summary).toMatch(/locked/);
    });

    // Regression: see above.
    it('does not mistake the save-lock wait timeout for a structure lock', async () => {
      trackService.upsertStructure.mockRejectedValueOnce(
        new ConflictException(
          'Another change to this course is still being saved. Try again in a moment.',
        ),
      );
      const outcome = await run('remove_item', { itemId: 'I-jr' });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'invalid',
      });
      expect(outcome.modelResult.message).toMatch(/still being saved/);
    });

    // Regression: see above.
    it('maps bad-request and not-found errors to a repairable "invalid", and anything else to tool_failed', async () => {
      trackService.upsertStructure.mockRejectedValueOnce(
        new BadRequestException('Section orders must be contiguous'),
      );
      expect(
        (await run('remove_item', { itemId: 'I-jr' })).modelResult,
      ).toMatchObject({
        ok: false,
        error: 'invalid',
        message: 'Section orders must be contiguous',
      });
      expect(
        (await run('remove_item', { itemId: 'made-up' })).modelResult,
      ).toMatchObject({
        ok: false,
        error: 'invalid',
      });
      trackService.upsertStructure.mockRejectedValueOnce(
        new Error('db exploded'),
      );
      expect(
        (await run('remove_item', { itemId: 'I-jr' })).modelResult,
      ).toMatchObject({
        ok: false,
        error: 'tool_failed',
        message: 'That change failed: db exploded',
      });
    });

    // Regression: see above.
    it('reports generation_failed when the repair pass is rejected too', async () => {
      specialists.quiz.generate.mockRejectedValue(
        new SpecialistValidationError(['still wrong']),
      );
      const outcome = await run('add_item', {
        sectionId: 'S3',
        type: 'QUIZ',
        title: 'Q',
      });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'generation_failed',
      });
      expect(outcome.modelResult.message).toContain('still wrong');
    });
  });

  // ── Reads ────────────────────────────────────────────────────────────────

  describe('reads', () => {
    it('get_course_outline returns ids, titles and rules — not content', async () => {
      const outcome = await run('get_course_outline');
      const outline = outcome.modelResult.outline;
      expect(outline.sections.map((s: any) => s.id)).toEqual([
        'S1',
        'S2',
        'S3',
      ]);
      expect(outline.sections[0].items[1]).toMatchObject({
        id: 'I-rp',
        type: 'ROLEPLAY',
        scenarioId: 5,
        rule: { minScore: 50, minDurationSeconds: 30 },
      });
      expect(JSON.stringify(outline)).not.toContain('hello world');
      expect(outcome.events).toBeUndefined(); // a read does not push a patch
    });

    it('get_item returns the item content and its section', async () => {
      const outcome = await run('get_item', { itemId: 'I-art' });
      expect(outcome.modelResult.item).toMatchObject({
        id: 'I-art',
        sectionId: 'S1',
        type: 'ARTICLE',
        content: { html: '<p>hello world</p>' },
      });
    });

    it('get_item caps a long article at 20 KB and marks the cut', async () => {
      build([
        {
          id: 'S1',
          title: 'Listen',
          items: [
            {
              id: 'I-big',
              type: 'ARTICLE',
              title: 'Big',
              content: { html: 'x'.repeat(30_000) },
            },
          ],
        },
      ] as any);
      const html: string = (await run('get_item', { itemId: 'I-big' }))
        .modelResult.item.content.html;
      expect(html.length).toBeLessThan(20_100);
      expect(html.endsWith('[truncated]')).toBe(true);
    });

    it('get_item refuses an unknown id', async () => {
      expect(
        (await run('get_item', { itemId: 'nope' })).modelResult,
      ).toMatchObject({
        ok: false,
        error: 'item_not_found',
      });
    });
  });

  // ── Publishing: confirmed in code ────────────────────────────────────────

  describe('publish_course', () => {
    it('returns not_ready with what is missing and asks nothing', async () => {
      store.track.coverImageUrl = null;
      store.sections[2].items = []; // S3 stays empty: a second gap

      const outcome = await run('publish_course');

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'not_ready',
      });
      expect(outcome.modelResult.missing).toEqual([
        expect.stringMatching(/Cover image needed/),
        'Empty: "Empty so far"',
      ]);
      expect(outcome.events).toBeUndefined(); // no question
      expect(outcome.endTurn).toBeUndefined();
      expect(sessionService.patchMetadata).not.toHaveBeenCalled();
      expect(trackService.updateTrack).not.toHaveBeenCalled();
    });

    describe('when the course is ready', () => {
      beforeEach(() => {
        // Fill the empty section so every readiness check passes.
        store.sections[2].items = [
          {
            id: 'I-x',
            sectionId: 'S3',
            type: 'JOURNAL',
            order: 1,
            title: 'Wrap up',
            description: null,
            scenarioId: null,
            caseId: null,
            content: { prompts: [] },
            completionCriteria: null,
            hasDiscussion: false,
          },
        ];
      });

      it('asks a confirmation question and ends the turn without publishing', async () => {
        const outcome = await run('publish_course');

        const question = questionOf(outcome);
        expect(outcome.endTurn).toBe(true);
        expect(question).toMatchObject({
          kind: 'singleSelect',
          allowCustom: false,
          prompt: expect.stringContaining('Staying with the texter'),
        });
        expect(question.options).toEqual([
          { id: 'confirm', label: 'Publish now', recommended: true },
          { id: 'cancel', label: 'Not now' },
        ]);
        expect(outcome.modelResult).toMatchObject({
          ok: true,
          awaitingConfirmation: true,
          questionId: question.id,
        });
        expect(trackService.updateTrack).not.toHaveBeenCalled();
      });

      it('stores the pending confirmation so the next turn can check the answer against it', async () => {
        const outcome = await run('publish_course');
        const questionId = questionOf(outcome).id;

        expect(sessionService.patchMetadata).toHaveBeenCalledWith('session-1', {
          pendingConfirmation: { action: 'publish', questionId, input: {} },
        });
        expect(session.metadata?.pendingConfirmation).toEqual({
          action: 'publish',
          questionId,
          input: {},
        });
      });

      it('publishes when the next turn answers THAT question with confirm', async () => {
        const questionId = questionOf(await run('publish_course')).id;
        nextTurn();

        const outcome = await run(
          'publish_course',
          {},
          { questionId, selectedOptionIds: ['confirm'] },
        );

        expect(trackService.updateTrack).toHaveBeenCalledWith('track-1', {
          status: 'ACTIVE',
        });
        expect(outcome.modelResult).toMatchObject({
          ok: true,
          changed: 'Published "Staying with the texter"',
        });
        expect(frame(outcome, 'course_patch').data.summary).toBe(
          'Published "Staying with the texter"',
        );
        expect(sessionService.appendChangeLog).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({ tool: 'publish_course' }),
        );
        // The confirmation is spent, and what was confirmed is on record.
        expect(session.metadata?.pendingConfirmation).toBeNull();
        expect(dbMetadata.lastConfirmed).toMatchObject({ action: 'publish' });
      });

      it('publishes as the session owner', async () => {
        const questionId = questionOf(await run('publish_course')).id;
        nextTurn();
        await run(
          'publish_course',
          {},
          { questionId, selectedOptionIds: ['confirm'] },
        );
        expect(ranAs).toEqual(['7']);
      });

      it('re-asks, with a fresh question id, when the answer is to a different question', async () => {
        const firstId = questionOf(await run('publish_course')).id;
        nextTurn();

        const outcome = await run(
          'publish_course',
          {},
          { questionId: 'some-other-question', selectedOptionIds: ['confirm'] },
        );

        expect(trackService.updateTrack).not.toHaveBeenCalled();
        const second = questionOf(outcome);
        expect(second.id).not.toBe(firstId);
        expect(outcome.endTurn).toBe(true);
        // The pending confirmation now points at the new question only.
        expect(dbMetadata.pendingConfirmation.questionId).toBe(second.id);
      });

      it('re-asks when the trainer picked "Not now"', async () => {
        const questionId = questionOf(await run('publish_course')).id;
        nextTurn();

        const outcome = await run(
          'publish_course',
          {},
          { questionId, selectedOptionIds: ['cancel'] },
        );

        expect(trackService.updateTrack).not.toHaveBeenCalled();
        expect(outcome.endTurn).toBe(true);
        expect(questionOf(outcome).id).not.toBe(questionId);
      });

      it('re-asks when the answer carries no selection at all (free text)', async () => {
        const questionId = questionOf(await run('publish_course')).id;
        nextTurn();
        const outcome = await run(
          'publish_course',
          {},
          { questionId, customValues: ['yes please'] },
        );
        expect(trackService.updateTrack).not.toHaveBeenCalled();
        expect(outcome.endTurn).toBe(true);
      });

      it('does not publish on a "confirm" the model asserts with nothing pending', async () => {
        // The model cannot confirm for the trainer: no stored question, no publish.
        const outcome = await run(
          'publish_course',
          {},
          { questionId: 'made-up', selectedOptionIds: ['confirm'] },
        );
        expect(trackService.updateTrack).not.toHaveBeenCalled();
        expect(outcome.modelResult).toMatchObject({
          awaitingConfirmation: true,
        });
      });

      it('does not let a confirmation for another action publish', async () => {
        // A pending "assign" confirmation, answered with confirm, is not a publish confirmation.
        dbMetadata = {
          pendingConfirmation: {
            action: 'assign',
            questionId: 'q-assign',
            input: { tenantIds: ['t1'] },
          },
        };
        nextTurn();

        const outcome = await run(
          'publish_course',
          {},
          { questionId: 'q-assign', selectedOptionIds: ['confirm'] },
        );

        expect(trackService.updateTrack).not.toHaveBeenCalled();
        expect(outcome.endTurn).toBe(true);
      });

      it('is single-use: after publishing, the same answer cannot publish again', async () => {
        const questionId = questionOf(await run('publish_course')).id;
        nextTurn();
        const answer = { questionId, selectedOptionIds: ['confirm'] };
        await run('publish_course', {}, answer);
        expect(trackService.updateTrack).toHaveBeenCalledTimes(1);

        // Same turn, model calls it again: the course is already live.
        const again = await run('publish_course', {}, answer);
        expect(trackService.updateTrack).toHaveBeenCalledTimes(1);
        expect(again.modelResult).toMatchObject({
          ok: true,
          alreadyPublished: true,
        });
      });
    });

    it('reports an already published course instead of asking', async () => {
      store.track.status = 'ACTIVE';
      const outcome = await run('publish_course');
      expect(outcome.modelResult).toEqual({ ok: true, alreadyPublished: true });
      expect(outcome.events).toBeUndefined();
    });
  });

  describe('assign_to_tenants', () => {
    it('refuses when none of the ids is an organisation', async () => {
      const outcome = await run('assign_to_tenants', { tenantIds: ['nope'] });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'invalid',
      });
      expect(outcome.events).toBeUndefined();
    });

    it('asks first, naming the organisations, and stores the resolved ids', async () => {
      const outcome = await run('assign_to_tenants', {
        tenantIds: ['t1', 't2'],
      });

      expect(trackTenantService.assignTracksToTenant).not.toHaveBeenCalled();
      expect(outcome.endTurn).toBe(true);
      const question = questionOf(outcome);
      expect(question.prompt).toContain('Acme, Beta Org');
      expect(question.options[0].label).toBe('Assign to 2 organisations');
      expect(dbMetadata.pendingConfirmation).toEqual({
        action: 'assign',
        questionId: question.id,
        input: { tenantIds: ['t1', 't2'] },
      });
    });

    it('acts on the stored input, not on what the model passes after the confirmation', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1', 't2'] }),
      ).id;
      nextTurn();

      // After the trainer confirmed "Acme, Beta Org", the model drifts and
      // passes a different list on the confirming call.
      await run(
        'assign_to_tenants',
        { tenantIds: ['t3'] },
        { questionId, selectedOptionIds: ['confirm'] },
      );

      expect(
        trackTenantService.assignTracksToTenant.mock.calls.map((c) => c[0]),
      ).toEqual(['t1', 't2']);
      expect(trackTenantService.assignTracksToTenant).toHaveBeenCalledWith(
        't1',
        { trackIds: ['track-1'] },
      );
      expect(trackTenantService.assignTracksToTenant).not.toHaveBeenCalledWith(
        't3',
        expect.anything(),
      );
    });

    // Regression (fixed 2026-10-14): the confirmed assignment is correct (the stored ids), but the
    // summary / change log is built from the ids the model passed on the
    // confirming call. edit-tools.service.ts assignToTenants(): `names` is
    // computed from `tenants` (this call's input) before confirmOrAsk, and the
    // final changed() uses it, so the course's change log and the model's
    // answer say it was assigned to "Gamma" when it went to Acme and Beta Org.
    it('reports the organisations that were actually assigned, even if the model passed others', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1', 't2'] }),
      ).id;
      nextTurn();

      const outcome = await run(
        'assign_to_tenants',
        { tenantIds: ['t3'] },
        { questionId, selectedOptionIds: ['confirm'] },
      );

      expect(outcome.summary).toContain('Acme');
      expect(outcome.summary).toContain('Beta Org');
      expect(outcome.summary).not.toContain('Gamma');
    });

    it('assigns the confirmed organisations when the model repeats the same input', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1'] }),
      ).id;
      nextTurn();

      const outcome = await run(
        'assign_to_tenants',
        { tenantIds: ['t1'] },
        { questionId, selectedOptionIds: ['confirm'] },
      );

      expect(trackTenantService.assignTracksToTenant).toHaveBeenCalledTimes(1);
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        changed: 'Assigned the course to Acme',
      });
      expect(ranAs).toEqual([]); // assignment runs through the tenant service, not updateTrack
    });

    it('re-asks instead of assigning when the answer was "Not now"', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1'] }),
      ).id;
      nextTurn();
      const outcome = await run(
        'assign_to_tenants',
        { tenantIds: ['t1'] },
        { questionId, selectedOptionIds: ['cancel'] },
      );
      expect(trackTenantService.assignTracksToTenant).not.toHaveBeenCalled();
      expect(outcome.endTurn).toBe(true);
    });

    it('treats "already assigned" (a 409) as success', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1', 't2'] }),
      ).id;
      nextTurn();
      trackTenantService.assignTracksToTenant
        .mockRejectedValueOnce(new ConflictException('already assigned'))
        .mockResolvedValueOnce(undefined);

      const done = await run(
        'assign_to_tenants',
        { tenantIds: ['t1', 't2'] },
        { questionId, selectedOptionIds: ['confirm'] },
      );

      expect(done.modelResult.ok).toBe(true);
      expect(trackTenantService.assignTracksToTenant).toHaveBeenCalledTimes(2);
    });

    it('does not swallow any other assignment failure', async () => {
      const questionId = questionOf(
        await run('assign_to_tenants', { tenantIds: ['t1'] }),
      ).id;
      nextTurn();
      trackTenantService.assignTracksToTenant.mockRejectedValueOnce(
        new Error('db down'),
      );

      const result = await (async () => {
        try {
          return (
            await run(
              'assign_to_tenants',
              { tenantIds: ['t1'] },
              { questionId, selectedOptionIds: ['confirm'] },
            )
          ).modelResult;
        } catch (error) {
          return { ok: false, message: (error as Error).message };
        }
      })();

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/db down/);
    });
  });

  describe('duplicate_course', () => {
    it('asks, then duplicates on confirmation and rebinds the session to the copy', async () => {
      const questionId = questionOf(await run('duplicate_course')).id;
      expect(trackService.duplicateTrack).not.toHaveBeenCalled();
      nextTurn();
      // Once duplicated, reads are of the copy.
      trackService.duplicateTrack.mockImplementation(async () => {
        store.track.id = 'track-copy';
        return { id: 'track-copy', title: 'Copy of Staying with the texter' };
      });

      const outcome = await run(
        'duplicate_course',
        {},
        { questionId, selectedOptionIds: ['confirm'] },
      );

      expect(trackService.duplicateTrack).toHaveBeenCalledWith('track-1');
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({
          trackId: 'track-copy',
          trackIdMap: { sections: {}, items: {} },
        }),
      );
      // The id map belongs to the old course: it must not carry over.
      expect(session.trackId).toBe('track-copy');
      expect(session.trackIdMap).toEqual({ sections: {}, items: {} });
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        newTrackId: 'track-copy',
      });
    });
  });

  // ── Completion rules ─────────────────────────────────────────────────────

  describe('set_completion_rule', () => {
    const rule = (itemId: string, completionCriteria: Record<string, any>) =>
      run('set_completion_rule', { itemId, completionCriteria });
    const itemRow = (id: string) => store.item(id);

    it('clamps a roleplay minScore to 0-100 and rounds minDurationSeconds', async () => {
      await rule('I-rp', { minScore: 150, minDurationSeconds: 90.6 });
      expect(itemRow('I-rp').completionCriteria).toEqual({
        minScore: 100,
        minDurationSeconds: 91,
      });

      await rule('I-rp', { minScore: -5 });
      expect(itemRow('I-rp').completionCriteria.minScore).toBe(0);
    });

    it('merges into the existing rule rather than replacing it', async () => {
      await rule('I-rp', { minScore: 70 });
      expect(itemRow('I-rp').completionCriteria).toEqual({
        minScore: 70,
        minDurationSeconds: 30,
      });
    });

    it('keeps only the keys that mean something for the item type', async () => {
      // passScore is a quiz rule; on a roleplay it is simply not a rule.
      const result = await refused('set_completion_rule', {
        itemId: 'I-rp',
        completionCriteria: { passScore: 80 },
      });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/No valid rule for a ROLEPLAY item/);
      expect(itemRow('I-rp').completionCriteria).toEqual({
        minScore: 50,
        minDurationSeconds: 30,
      });

      await rule('I-rp', { minScore: 60, passScore: 80, watchPct: 10 });
      expect(itemRow('I-rp').completionCriteria).toEqual({
        minScore: 60,
        minDurationSeconds: 30,
      });
    });

    it('maps each type to its own rule', async () => {
      await rule('I-cs', { minScore: 65 });
      expect(itemRow('I-cs').completionCriteria).toEqual({ minScore: 65 });

      await rule('I-art', { minReadSeconds: 45.4 });
      expect(itemRow('I-art').completionCriteria).toEqual({
        minReadSeconds: 45,
      });

      await rule('I-vd', { watchPct: 75 });
      expect(itemRow('I-vd').completionCriteria).toEqual({ watchPct: 75 });
    });

    it('keeps a video watch percentage within 1-100', async () => {
      await rule('I-vd', { watchPct: 0 });
      expect(itemRow('I-vd').completionCriteria.watchPct).toBe(1); // 0 would mean "never watched"
      await rule('I-vd', { watchPct: 400 });
      expect(itemRow('I-vd').completionCriteria.watchPct).toBe(100);
    });

    it('refuses a negative reading time', async () => {
      const result = await refused('set_completion_rule', {
        itemId: 'I-art',
        completionCriteria: { minReadSeconds: -3 },
      });
      expect(result.ok).toBe(false);
      expect(store.item('I-art').completionCriteria).toBeNull();
    });

    it('mirrors a quiz passScore into the content settings, leaving the rest of the content alone', async () => {
      // The save copies content → rule; moving only one would be undone by it.
      await rule('I-qz', { passScore: 85 });

      expect(itemRow('I-qz').completionCriteria).toEqual({ passScore: 85 });
      expect(itemRow('I-qz').content).toEqual({
        questions: [{ id: 'q1' }],
        settings: { passScore: 85, shuffle: true },
      });
    });

    it('mirrors an annotation passScore too', async () => {
      await rule('I-an', { passScore: 55 });
      expect(itemRow('I-an').content.settings.passScore).toBe(55);
      expect(itemRow('I-an').completionCriteria).toEqual({ passScore: 55 });
    });

    it('clamps a pass score above 100', async () => {
      await rule('I-qz', { passScore: 140 });
      expect(itemRow('I-qz').completionCriteria.passScore).toBe(100);
      expect(itemRow('I-qz').content.settings.passScore).toBe(100);
    });

    it('does not invent settings on a quiz that has none', async () => {
      store.item('I-qz').content = { questions: [] };
      await rule('I-qz', { passScore: 85 });
      expect(itemRow('I-qz').content).toEqual({ questions: [] });
      expect(itemRow('I-qz').completionCriteria.passScore).toBe(85);
    });

    it('refuses a game: it never gates progress', async () => {
      const result = await refused('set_completion_rule', {
        itemId: 'I-gm',
        completionCriteria: { minScore: 50, passScore: 50 },
      });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Games never gate progress/);
      expect(itemRow('I-gm').completionCriteria).toBeNull();
    });

    it('refuses an unknown item and an empty rule, saving nothing', async () => {
      expect(
        (
          await refused('set_completion_rule', {
            itemId: 'nope',
            completionCriteria: { minScore: 5 },
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await refused('set_completion_rule', {
            itemId: 'I-rp',
            completionCriteria: {},
          })
        ).ok,
      ).toBe(false);
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('records the change and pushes the new outline to the pane', async () => {
      const outcome = await rule('I-rp', { minScore: 80 });

      expect(outcome.modelResult).toMatchObject({ ok: true });
      // The summary names the rule that was set; the merge with the item's
      // existing minDurationSeconds happens underneath.
      expect(outcome.summary).toBe('Set the rule on "Asha" to {"minScore":80}');
      expect(sessionService.appendChangeLog).toHaveBeenCalledWith('session-1', {
        summary: outcome.summary,
        tool: 'set_completion_rule',
        itemId: 'I-rp',
      });
      const patch = frame(outcome, 'course_patch').data;
      expect(patch.itemIds).toEqual(['I-rp']);
      expect(patch.outline.sections).toHaveLength(3);
    });
  });

  // ── add_item ─────────────────────────────────────────────────────────────

  describe('add_item', () => {
    it('queues a new roleplay as a background job, with its placement, and says so', async () => {
      const outcome = await run('add_item', {
        sectionId: 'S1',
        afterItemId: 'I-art',
        type: 'ROLEPLAY',
        title: 'A new caller',
        purpose: 'Practise the opening',
        spec: { personaBrief: 'Dev, 40, anxious', taskClass: 'cooperative' },
        completionCriteria: { minScore: 60 },
      });

      expect(buildService.enqueue).toHaveBeenCalledTimes(1);
      const [, job] = buildService.enqueue.mock.calls[0];
      expect(job.kind).toBe(CourseCopilotJobKind.ROLEPLAY_NEW);
      expect(job.input).toMatchObject({
        title: 'A new caller',
        placement: { trackSectionId: 'S1', afterTrackItemId: 'I-art' },
        item: {
          type: 'ROLEPLAY',
          title: 'A new caller',
          purpose: 'Practise the opening',
          source: { kind: 'new' },
          spec: { personaBrief: 'Dev, 40, anxious', taskClass: 'cooperative' },
          completionCriteria: { minScore: 60 },
        },
      });
      expect(outcome.modelResult).toMatchObject({
        ok: true,
        queued: true,
        jobId: 'job-1',
      });
      expect(outcome.events).toEqual([
        { event: 'build_started', data: { jobCount: 1 } },
      ]);
      // Nothing is written to the course yet: the job places it when it is ready.
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('queues with no anchor when afterItemId is omitted', async () => {
      await run('add_item', {
        sectionId: 'S1',
        type: 'roleplay',
        title: 'Another',
      });
      expect(buildService.enqueue.mock.calls[0][1].input.placement).toEqual({
        trackSectionId: 'S1',
        afterTrackItemId: null,
      });
    });

    it('adds a library roleplay straight into the course when scenarioId is given', async () => {
      const outcome = await run('add_item', {
        sectionId: 'S2',
        type: 'ROLEPLAY',
        title: 'Library roleplay',
        scenarioId: 6,
        completionCriteria: { minScore: 60 },
      });

      expect(buildService.enqueue).not.toHaveBeenCalled();
      expect(titles(1)).toEqual(['Journal', 'Library roleplay']);
      expect(store.sections[1].items[1]).toMatchObject({
        type: 'ROLEPLAY',
        scenarioId: 6,
        completionCriteria: { minScore: 60 },
      });
      expect(outcome.modelResult).toMatchObject({ ok: true });
    });

    it('refuses a library roleplay that is not published', async () => {
      const outcome = await run('add_item', {
        sectionId: 'S2',
        type: 'ROLEPLAY',
        title: 'x',
        scenarioId: 999,
      });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'invalid',
        message: 'That roleplay is not published.',
      });
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('refuses a new case from chat — it needs its roleplays to exist first', async () => {
      const outcome = await run('add_item', {
        sectionId: 'S1',
        type: 'CASE',
        title: 'A case',
      });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'unsupported',
      });
      expect(outcome.modelResult.message).toMatch(/caseId/);
      expect(buildService.enqueue).not.toHaveBeenCalled();
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('adds an existing published case by caseId, and refuses an unpublished one', async () => {
      const ok = await run('add_item', {
        sectionId: 'S2',
        type: 'CASE',
        title: 'Case two',
        caseId: 'case-1',
      });
      expect(ok.modelResult.ok).toBe(true);
      expect(store.sections[1].items[1]).toMatchObject({
        type: 'CASE',
        caseId: 'case-1',
      });

      const bad = await run('add_item', {
        sectionId: 'S2',
        type: 'CASE',
        title: 'Case three',
        caseId: 'case-404',
      });
      expect(bad.modelResult).toMatchObject({
        ok: false,
        message: 'That case is not published.',
      });
    });

    it('refuses a video with no link and asks the model to ask the trainer', async () => {
      const outcome = await run('add_item', {
        sectionId: 'S1',
        type: 'VIDEO',
        title: 'Clip two',
        spec: {},
      });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'needs_input',
      });
      expect(outcome.modelResult.message).toMatch(/Ask the trainer/);
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it.each(['not-a-url', 'ftp://files.test/clip.mp4', 'javascript:alert(1)'])(
      'refuses a video whose link is %s',
      async (url) => {
        const outcome = await run('add_item', {
          sectionId: 'S1',
          type: 'VIDEO',
          title: 'Clip',
          spec: { url },
        });
        expect(outcome.modelResult).toMatchObject({
          ok: false,
          error: 'needs_input',
        });
      },
    );

    it('adds a video with its source inferred and the default 90% watch rule', async () => {
      await run('add_item', {
        sectionId: 'S2',
        type: 'VIDEO',
        title: 'Vimeo clip',
        spec: { url: 'https://vimeo.com/123' },
      });
      expect(store.sections[1].items[1]).toMatchObject({
        type: 'VIDEO',
        content: { source: 'vimeo', url: 'https://vimeo.com/123' },
        completionCriteria: { watchPct: 90 },
      });
    });

    it('adds a game with its key and no completion rule', async () => {
      await run('add_item', {
        sectionId: 'S2',
        type: 'GAME',
        title: 'Break',
        spec: { gameKey: 'MEMORY_MATCH', intro: 'Two minutes off.' },
        completionCriteria: { minScore: 50 }, // ignored: games never gate
      });
      expect(store.sections[1].items[1]).toMatchObject({
        type: 'GAME',
        content: { gameKey: 'MEMORY_MATCH', intro: 'Two minutes off.' },
        completionCriteria: null,
      });
    });

    it('falls back to a valid game when the model invents a gameKey', async () => {
      await run('add_item', {
        sectionId: 'S2',
        type: 'GAME',
        title: 'Break',
        spec: { gameKey: 'DOOM' },
      });
      expect(store.sections[1].items[1].type).toBe('GAME');
      expect(store.sections[1].items[1].content.gameKey).not.toBe('DOOM');
    });

    it.each([
      [
        { sectionId: 'S1', type: 'PODCAST', title: 'x' },
        'invalid',
        /Unknown item type/,
      ],
      [
        { sectionId: 'S1', type: 'JOURNAL', title: '  ' },
        'invalid',
        /needs a title/,
      ],
      [
        { sectionId: 'nope', type: 'JOURNAL', title: 'x' },
        'section_not_found',
        /No section with id nope/,
      ],
    ])('refuses %j', async (input, error, message) => {
      const outcome = await run('add_item', input);
      expect(outcome.modelResult).toMatchObject({ ok: false, error });
      expect(outcome.modelResult.message).toMatch(message as RegExp);
    });

    describe('written now (article, quiz, journal, annotation)', () => {
      beforeEach(() => jest.useFakeTimers()); // the inline call races a 90s timeout
      afterEach(() => jest.useRealTimers());

      const written = { content: { html: '<p>fresh</p>' }, summary: '1 words' };

      it('generates the content, inserts it after the anchor, and logs it', async () => {
        specialists.article.generate.mockResolvedValue(written);

        const outcome = await run('add_item', {
          sectionId: 'S1',
          afterItemId: 'I-art',
          type: 'ARTICLE',
          title: 'Second article',
          purpose: 'Reinforce',
          spec: { outline: ['a', 'b'] },
          completionCriteria: { minReadSeconds: 30 },
        });

        expect(titles()).toEqual([
          'Name the feeling',
          'Second article',
          'Asha',
          'Check',
          'Clip',
          'Play',
          'The case',
          'Annotate',
        ]);
        expect(store.sections[0].items[1]).toMatchObject({
          type: 'ARTICLE',
          content: { html: '<p>fresh</p>' },
          completionCriteria: { minReadSeconds: 30 },
        });
        expect(outcome.modelResult).toMatchObject({
          ok: true,
          itemId: store.sections[0].items[1].id,
        });
        expect(specialists.article.generate).toHaveBeenCalledTimes(1);
        // The specialist is told it is an edit-loop job, with the placement.
        expect(executor.specialistContext.mock.calls[0][1].input).toMatchObject(
          {
            title: 'Second article',
            placement: { trackSectionId: 'S1', afterTrackItemId: 'I-art' },
            item: {
              type: 'ARTICLE',
              purpose: 'Reinforce',
              spec: { outline: ['a', 'b'] },
            },
          },
        );
        expect(executor.specialistContext.mock.calls[0][2]).toMatchObject({
          courseCopilotSessionId: 'session-1',
          tool: 'edit_loop',
        });
      });

      it('uses the specialist that matches the type', async () => {
        specialists.quiz.generate.mockResolvedValue({
          content: { questions: [{}] },
        });
        specialists.journal.generate.mockResolvedValue({
          content: { prompts: [{}] },
        });
        specialists.annotation.generate.mockResolvedValue({
          content: { units: [] },
        });

        await run('add_item', { sectionId: 'S3', type: 'QUIZ', title: 'Q' });
        await run('add_item', { sectionId: 'S3', type: 'JOURNAL', title: 'J' });
        await run('add_item', {
          sectionId: 'S3',
          type: 'ANNOTATED_ARTIFACT',
          title: 'A',
        });

        expect(specialists.quiz.generate).toHaveBeenCalledTimes(1);
        expect(specialists.journal.generate).toHaveBeenCalledTimes(1);
        expect(specialists.annotation.generate).toHaveBeenCalledTimes(1);
        expect(specialists.article.generate).not.toHaveBeenCalled();
        expect(titles(2)).toEqual(['Q', 'J', 'A']);
      });

      it('retries once with the validator errors, then succeeds', async () => {
        specialists.quiz.generate
          .mockRejectedValueOnce(
            new SpecialistValidationError(['q1 has no correct answer']),
          )
          .mockResolvedValueOnce({ content: { questions: [{}] } });

        const outcome = await run('add_item', {
          sectionId: 'S3',
          type: 'QUIZ',
          title: 'Q',
        });

        expect(outcome.modelResult.ok).toBe(true);
        expect(specialists.quiz.generate).toHaveBeenCalledTimes(2);
        expect(
          executor.specialistContext.mock.calls[1][1].input.repairErrors,
        ).toEqual(['q1 has no correct answer']);
        expect(
          executor.specialistContext.mock.calls[0][1].input.repairErrors,
        ).toBeUndefined();
      });

      it('refuses, without touching the course, after two validator rejections', async () => {
        specialists.quiz.generate.mockRejectedValue(
          new SpecialistValidationError(['still wrong']),
        );

        const result = await refused('add_item', {
          sectionId: 'S3',
          type: 'QUIZ',
          title: 'Q',
        });

        expect(result.ok).toBe(false);
        expect(result.message).toContain('still wrong');
        expect(specialists.quiz.generate).toHaveBeenCalledTimes(2);
        expect(titles(2)).toEqual([]);
        expect(trackService.upsertStructure).not.toHaveBeenCalled();
      });

      it('gives up with a readable message when the specialist takes too long', async () => {
        specialists.quiz.generate.mockReturnValue(new Promise(() => undefined));

        const pending = refused('add_item', {
          sectionId: 'S3',
          type: 'QUIZ',
          title: 'Q',
        });
        await jest.advanceTimersByTimeAsync(91_000);
        const result = await pending;

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/took too long/);
        expect(titles(2)).toEqual([]);
      });

      it('queues an article image for the new article when the item asks for one', async () => {
        specialists.article.generate.mockResolvedValue(written);

        const outcome = await run('add_item', {
          sectionId: 'S3',
          type: 'ARTICLE',
          title: 'Illustrated',
          spec: { withImage: true },
        });

        const created = store.sections[2].items[0];
        expect(buildService.enqueue).toHaveBeenCalledTimes(1);
        expect(buildService.enqueue.mock.calls[0][1]).toMatchObject({
          kind: CourseCopilotJobKind.ARTICLE_IMAGE,
          input: { title: 'Illustrated', articleTrackItemId: created.id },
        });
        expect(outcome.events?.map((e) => e.event)).toEqual([
          'build_started',
          'course_patch',
        ]);
      });

      it('queues an article image for every article when the brief asked for one-per-article', async () => {
        session.brief = { look: { articleImages: 'one-per-article' } };
        specialists.article.generate.mockResolvedValue(written);

        await run('add_item', {
          sectionId: 'S3',
          type: 'ARTICLE',
          title: 'Plain article',
        });

        expect(buildService.enqueue).toHaveBeenCalledTimes(1);
        expect(buildService.enqueue.mock.calls[0][1].kind).toBe(
          CourseCopilotJobKind.ARTICLE_IMAGE,
        );
      });

      it('queues no image for a plain article, or for a quiz that says withImage', async () => {
        specialists.article.generate.mockResolvedValue(written);
        specialists.quiz.generate.mockResolvedValue({
          content: { questions: [{}] },
        });
        await run('add_item', {
          sectionId: 'S3',
          type: 'ARTICLE',
          title: 'Plain',
        });
        await run('add_item', {
          sectionId: 'S3',
          type: 'QUIZ',
          title: 'Q',
          spec: { withImage: true },
        });
        expect(buildService.enqueue).not.toHaveBeenCalled();
      });
    });
  });

  // ── Sections and items ───────────────────────────────────────────────────

  describe('remove_section', () => {
    it('refuses a section that still has items, and leaves the course untouched', async () => {
      const before = JSON.stringify(store.snapshot());

      const outcome = await run('remove_section', { sectionId: 'S1' });

      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'not_empty',
      });
      expect(outcome.modelResult.message).toContain('7 item(s)');
      expect(outcome.modelResult.message).toMatch(/force: true/);
      expect(JSON.stringify(store.snapshot())).toBe(before);
      expect(sessionService.appendChangeLog).not.toHaveBeenCalled();
      expect(outcome.events).toBeUndefined();
    });

    it('removes a non-empty section only with force: true', async () => {
      const outcome = await run('remove_section', {
        sectionId: 'S1',
        force: true,
      });
      expect(outcome.modelResult.ok).toBe(true);
      expect(store.sections.map((s) => s.title)).toEqual([
        'Practise',
        'Empty so far',
      ]);
    });

    it.each(['true', 1, 'yes'])(
      'does not treat force=%j as the boolean true',
      async (force) => {
        const outcome = await run('remove_section', { sectionId: 'S1', force });
        expect(outcome.modelResult).toMatchObject({
          ok: false,
          error: 'not_empty',
        });
        expect(store.sections).toHaveLength(3);
      },
    );

    it('removes an empty section without force', async () => {
      const outcome = await run('remove_section', { sectionId: 'S3' });
      expect(outcome.modelResult.ok).toBe(true);
      expect(store.sections.map((s) => s.id)).toEqual(['S1', 'S2']);
      expect(store.sections.map((s) => s.order)).toEqual([1, 2]);
    });

    it('refuses an unknown section', async () => {
      const result = await refused('remove_section', { sectionId: 'nope' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/No section with id nope/);
      expect(store.sections).toHaveLength(3);
    });
  });

  describe('structure edits', () => {
    it('add_section places a new empty section after the one named, and warns it blocks publishing', async () => {
      const outcome = await run('add_section', {
        title: 'Wrap up',
        afterSectionId: 'S1',
      });
      expect(store.sections.map((s) => s.title)).toEqual([
        'Listen',
        'Wrap up',
        'Practise',
        'Empty so far',
      ]);
      expect(outcome.summary).toMatch(/empty section blocks publishing/);
    });

    it('add_section appends when the anchor is missing or unknown, and needs a title', async () => {
      await run('add_section', { title: 'End', afterSectionId: 'gone' });
      expect(store.sections[3].title).toBe('End');
      expect(
        (await run('add_section', { title: '   ' })).modelResult,
      ).toMatchObject({ ok: false, error: 'invalid' });
    });

    it('update_section renames and keeps the items', async () => {
      await run('update_section', {
        sectionId: 'S2',
        title: 'Practice',
        description: 'Apply it',
      });
      expect(store.sections[1]).toMatchObject({
        title: 'Practice',
        description: 'Apply it',
      });
      expect(store.sections[1].items).toHaveLength(1);
    });

    it('move_section moves to a 1-based position, clamping past the end', async () => {
      await run('move_section', { sectionId: 'S3', position: 1 });
      expect(store.sections.map((s) => s.id)).toEqual(['S3', 'S1', 'S2']);
      await run('move_section', { sectionId: 'S3', position: 99 });
      expect(store.sections.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
    });

    it('move_item moves across sections and keeps the row id', async () => {
      const outcome = await run('move_item', {
        itemId: 'I-jr',
        sectionId: 'S1',
        position: 2,
      });
      expect(outcome.modelResult.ok).toBe(true);
      expect(titles(0).slice(0, 3)).toEqual([
        'Name the feeling',
        'Journal',
        'Asha',
      ]);
      expect(store.sections[1].items).toHaveLength(0);
      expect(store.item('I-jr')).toBeDefined(); // moved, not recreated: progress rows point at it
    });

    it('move_item refuses an unknown item or target section without saving', async () => {
      expect(
        (
          await refused('move_item', {
            itemId: 'nope',
            sectionId: 'S1',
            position: 1,
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await refused('move_item', {
            itemId: 'I-jr',
            sectionId: 'nope',
            position: 1,
          })
        ).ok,
      ).toBe(false);
      expect(trackService.upsertStructure).not.toHaveBeenCalled();
    });

    it('remove_item removes exactly that item', async () => {
      await run('remove_item', { itemId: 'I-gm' });
      expect(titles()).not.toContain('Play');
      expect(titles()).toHaveLength(6);
    });

    it('update_item_content validates content and refuses it on roleplay and case items', async () => {
      const ok = await run('update_item_content', {
        itemId: 'I-art',
        title: 'Retitled',
        content: { html: '<p>new</p>' },
      });
      expect(ok.modelResult.ok).toBe(true);
      expect(store.item('I-art')).toMatchObject({
        title: 'Retitled',
        content: { html: '<p>new</p>' },
      });

      // An empty article is rejected by the same validator the editor uses, and
      // nothing of the call (not even the new title) is saved.
      const empty = await refused('update_item_content', {
        itemId: 'I-art',
        title: 'Second title',
        content: { html: '   ' },
      });
      expect(empty.ok).toBe(false);
      expect(store.item('I-art')).toMatchObject({
        title: 'Retitled',
        content: { html: '<p>new</p>' },
      });

      const roleplay = await refused('update_item_content', {
        itemId: 'I-rp',
        content: { html: 'x' },
      });
      expect(roleplay.message).toMatch(/set_item_reference/);
    });

    it('set_item_reference swaps a roleplay for a published one and refuses others', async () => {
      expect(
        (await run('set_item_reference', { itemId: 'I-rp', scenarioId: 6 }))
          .modelResult.ok,
      ).toBe(true);
      expect(store.item('I-rp').scenarioId).toBe(6);

      // An unpublished roleplay is refused before anything is written.
      expect(
        (await run('set_item_reference', { itemId: 'I-rp', scenarioId: 999 }))
          .modelResult.message,
      ).toBe('That roleplay is not published.');
      // A scenarioId on an article makes no sense.
      expect(
        (
          await refused('set_item_reference', {
            itemId: 'I-art',
            scenarioId: 6,
          })
        ).ok,
      ).toBe(false);
      expect(store.item('I-rp').scenarioId).toBe(6);
    });
  });

  describe('update_course_meta', () => {
    it('updates only the given fields, as the owner', async () => {
      const outcome = await run('update_course_meta', {
        title: '  A better title  ',
        estimatedDurationMinutes: 44.6,
        competencyIds: [1, 'c-2'],
      });
      expect(trackService.updateTrack).toHaveBeenCalledWith('track-1', {
        title: 'A better title',
        estimatedDurationMinutes: 45,
        competencyIds: ['1', 'c-2'],
      });
      expect(ranAs).toEqual(['7']);
      expect(outcome.summary).toBe(
        'Updated the course title, estimatedDurationMinutes, competencyIds',
      );
    });

    it('requires an https cover image', async () => {
      const outcome = await run('update_course_meta', {
        coverImageUrl: 'http://cdn.example.org/c.png',
      });
      expect(outcome.modelResult).toMatchObject({
        ok: false,
        error: 'invalid',
      });
      expect(trackService.updateTrack).not.toHaveBeenCalled();
    });

    it('refuses a call that changes nothing, and never changes status', async () => {
      expect((await run('update_course_meta', {})).modelResult).toMatchObject({
        ok: false,
        error: 'no_change',
      });
      await run('update_course_meta', { title: 'T', status: 'ACTIVE' });
      expect(trackService.updateTrack.mock.calls[0][1]).not.toHaveProperty(
        'status',
      );
    });
  });

  describe('generate_cover_image', () => {
    it('queues the image job in the background', async () => {
      const outcome = await run('generate_cover_image', {
        prompt: 'warm, hopeful',
      });
      expect(buildService.enqueue.mock.calls[0][1]).toMatchObject({
        kind: CourseCopilotJobKind.COVER_IMAGE,
        input: { title: 'Cover image', prompt: 'warm, hopeful' },
      });
      expect(outcome.modelResult).toMatchObject({ ok: true, queued: true });
      expect(outcome.events).toEqual([
        { event: 'build_started', data: { jobCount: 1 } },
      ]);
    });
  });
});
