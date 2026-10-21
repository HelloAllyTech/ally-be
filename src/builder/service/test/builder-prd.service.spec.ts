import { BadRequestException } from '@nestjs/common';
import { BuilderPrdService } from '../builder-prd.service';
import { BuilderPrdVersionAuthor } from '../../enum/builder.enum';
import {
  BuilderPrdDocument,
  createEmptyPrdDocument,
} from '../../type/builder-prd.type';

/** A PRD that clears every rubric row, so a test can knock out one at a time. */
const buildReadyPrd = (): BuilderPrdDocument => ({
  ...createEmptyPrdDocument('Add a Builder tab'),
  summary:
    'A new admin tab where an admin is interviewed into a PRD and the agent then builds it.',
  problem:
    'Feature work stalls between an idea and a scoped ticket, and the scoping that does happen is not captured anywhere a coding agent can read.',
  usersAndContext:
    'Ally platform admins working in the admin dashboard, usually alone and mid-week.',
  existingBehaviour:
    'Nothing exists for this yet: there is no builder module, no builder_sessions table and no admin route. Searched for builder, prd, interview and copilot across ally-be and ally-web.',
  whereChangesBelong:
    '- ally-be: the interview, the PRD document and the readiness rubric are all server-side, so every requirement lands here. Nothing in ally-web renders them yet.',
  goals: 'Turn a feature idea into reviewable pull requests without a handoff.',
  nonGoals: 'Not a replacement for code review; humans still merge.',
  testPlanMd:
    'Unit tests for the readiness rubric will be written. An interview run end-to-end against a seeded admin will be performed to ensure quality.',
  e2ePlanMd:
    'Cypress tests covering the main user flows of the new feature will be added.',
  requirements: [
    {
      id: 'R1',
      title: 'PRD interview',
      description: 'The agent interviews the admin one question at a time.',
      acceptanceCriteria: ['Each question carries options plus a custom field'],
    },
  ],
  assumptions: [{ id: 'A1', text: 'Admins are internal', status: 'confirmed' }],
  technicalPlan: {
    repos: [
      {
        repo: 'ally-be',
        changesMd: 'New src/builder module (R1: the interview).',
      },
    ],
    dataModelMd: 'Six tables.',
    apiMd: 'REST under /v1/builder.',
  },
  openQuestions: [],
});

describe('BuilderPrdService', () => {
  let service: BuilderPrdService;
  let docRepository: {
    findBySession: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    docRepository = {
      findBySession: jest.fn(),
      save: jest.fn(async (doc) => doc),
      create: jest.fn((doc) => doc),
    };
    dataSource = { transaction: jest.fn() };
    service = new BuilderPrdService(docRepository as any, dataSource as any);
  });

  describe('computeReadiness', () => {
    /**
     * The section exists because an interview specified an already-shipped
     * feature — column, enum, picker and label map — after searching the
     * codebase twice. Blocking on it is the point: a requirement written
     * before anyone established what the platform already does is a guess,
     * and the resulting build passes every check while duplicating working
     * code.
     */
    it('blocks a build that never established what already exists', () => {
      const draft = buildReadyPrd();
      draft.existingBehaviour = '';

      const readiness = service.computeReadiness(draft);

      expect(readiness.ready).toBe(false);
      // Blockers carry the hint, not the label — it is what the admin reads
      // in the tooltip and what the agent acts on.
      expect(readiness.blockers).toContain('What already exists is empty.');
    });

    it('refuses a gesture in place of an answer', () => {
      const draft = buildReadyPrd();
      draft.existingBehaviour = 'Some existing functionality.';

      const readiness = service.computeReadiness(draft);

      expect(readiness.ready).toBe(false);
    });

    it('blocks on thin test and e2e plans', () => {
      const draft = buildReadyPrd();
      draft.testPlanMd = 'short plan';
      draft.e2ePlanMd = 'short e2e plan';

      const readiness = service.computeReadiness(draft);

      expect(readiness.ready).toBe(false);
      const testPlanSection = readiness.sections.find(
        (s) => s.key === 'testPlanMd',
      );
      const e2ePlanSection = readiness.sections.find(
        (s) => s.key === 'e2ePlanMd',
      );
      expect(testPlanSection?.ok).toBe(false);
      expect(testPlanSection?.hint).toContain('too thin');
      expect(e2ePlanSection?.ok).toBe(false);
      expect(e2ePlanSection?.hint).toContain('too thin');
    });

    it('scores an empty PRD at zero and lists every blocker', () => {
      const readiness = service.computeReadiness(createEmptyPrdDocument());

      // 0, not "however many rows pass vacuously": a blank PRD must not read
      // as partial progress.
      expect(readiness.score).toBe(0);
      expect(readiness.ready).toBe(false);
      // Every row failing must produce a hint — a blocker with no hint gives
      // the admin (and the agent) nothing to act on.
      expect(readiness.blockers.every((blocker) => blocker.length > 0)).toBe(
        true,
      );
    });

    it('scores content separately from clearance: a written PRD with an open question reads 100 but is not ready', () => {
      const draft = buildReadyPrd();
      draft.openQuestions = ['Should this be per-tenant?'];

      const readiness = service.computeReadiness(draft);

      expect(readiness.score).toBe(100);
      expect(readiness.ready).toBe(false);
      expect(readiness.blockers).toEqual([
        '1 open question(s) left to settle.',
      ]);
    });

    it('marks a complete PRD ready at 100', () => {
      const readiness = service.computeReadiness(buildReadyPrd());

      expect(readiness.ready).toBe(true);
      expect(readiness.score).toBe(100);
      expect(readiness.blockers).toEqual([]);
    });

    /**
     * The rule that would have caught ally-web#713.
     *
     * That PRD traced a notification badge that would not clear, was scoped to
     * ally-web because that is where the badge is, and the defect was an
     * ally-be query matching zero rows. A build cannot edit a repo it was not
     * given, so it fixed the layer it could reach, wrote a passing test for
     * the behaviour it had changed, and cleared every gate with the feature
     * still broken.
     */
    describe('every repo named as owning a change is planned', () => {
      it('blocks when the plan has no entry for a repo the PRD named', () => {
        const draft = buildReadyPrd();
        draft.whereChangesBelong =
          '- ally-web: the badge is rendered here.\n' +
          '- ally-be: the unread count is computed here, and this is where it is wrong.';
        draft.technicalPlan.repos = [
          { repo: 'ally-web', changesMd: 'Clear the badge.' },
        ];

        const readiness = service.computeReadiness(draft);

        expect(readiness.ready).toBe(false);
        expect(readiness.blockers.join(' ')).toContain('ally-be');
      });

      it('is satisfied once that repo is planned', () => {
        const draft = buildReadyPrd();
        draft.whereChangesBelong =
          '- ally-web: the badge is rendered here.\n' +
          '- ally-be: the unread count is computed here.';
        draft.technicalPlan.repos = [
          { repo: 'ally-web', changesMd: 'Clear the badge.' },
          {
            repo: 'ally-be',
            changesMd: 'Match unread rows with IS NULL (R1).',
          },
        ];

        expect(service.computeReadiness(draft).ready).toBe(true);
      });

      /**
       * Naming a repo to rule it out is a normal thing to write, and the first
       * version of this rule flagged exactly that — on this file's own
       * fixture. A check that punishes useful prose teaches people to stop
       * writing it.
       */
      it('ignores a repo mentioned in passing rather than owning a line', () => {
        const draft = buildReadyPrd();
        draft.whereChangesBelong =
          '- ally-be: the count is computed here, and nothing in ally-mobile ' +
          'or ally-web has to change for it.';
        draft.technicalPlan.repos = [
          {
            repo: 'ally-be',
            changesMd: 'Match unread rows with IS NULL (R1).',
          },
        ];

        expect(service.computeReadiness(draft).ready).toBe(true);
      });

      /** A blank section is not a claim about any repo. */
      it('passes vacuously before anything has been written', () => {
        const draft = buildReadyPrd();
        draft.whereChangesBelong = '';

        expect(
          service.computeReadiness(draft).blockers.join(' '),
        ).not.toContain('not in the plan');
      });
    });

    it('blocks on an unconfirmed assumption', () => {
      const draft = buildReadyPrd();
      draft.assumptions = [
        { id: 'A1', text: 'Admins are internal', status: 'unconfirmed' },
      ];

      const readiness = service.computeReadiness(draft);

      expect(readiness.ready).toBe(false);
      expect(
        readiness.sections.find((section) => section.key === 'assumptions')?.ok,
      ).toBe(false);
    });

    it('blocks on an open question', () => {
      const draft = buildReadyPrd();
      draft.openQuestions = ['Does this need per-tenant gating?'];

      expect(service.computeReadiness(draft).ready).toBe(false);
    });

    it('blocks a requirement that has no acceptance criteria', () => {
      const draft = buildReadyPrd();
      draft.requirements = [
        {
          id: 'R1',
          title: 'PRD interview',
          description: 'Interviews the admin.',
          acceptanceCriteria: [],
        },
      ];

      const readiness = service.computeReadiness(draft);
      const section = readiness.sections.find(
        (entry) => entry.key === 'requirements',
      );

      expect(readiness.ready).toBe(false);
      expect(section?.hint).toContain('acceptance criteria');
    });

    it('blocks a repo listed in the technical plan with no described changes', () => {
      const draft = buildReadyPrd();
      draft.technicalPlan.repos = [
        { repo: 'ally-be', changesMd: 'New src/builder module.' },
        { repo: 'ally-web', changesMd: '   ' },
      ];

      const readiness = service.computeReadiness(draft);
      const section = readiness.sections.find(
        (entry) => entry.key === 'technicalPlan',
      );

      expect(readiness.ready).toBe(false);
      expect(section?.hint).toContain('ally-web');
    });

    // Caught live: the agent adds a technical-plan entry as soon as it knows a
    // change is needed, sometimes before it has settled which repo owns it.
    // A plan naming no repo used to pass the rubric as complete.
    it('blocks a planned change with no repo chosen', () => {
      const draft = buildReadyPrd();
      draft.technicalPlan.repos = [
        { repo: 'ally-be', changesMd: 'New src/builder module.' },
        { repo: '', changesMd: 'A digest email job somewhere.' },
      ];

      const readiness = service.computeReadiness(draft);
      const section = readiness.sections.find(
        (entry) => entry.key === 'technicalPlan',
      );

      expect(readiness.ready).toBe(false);
      // The admin's half stays a short sentence; it renders in a small
      // tooltip and a paragraph of JSON Pointers there is unreadable.
      expect(section?.hint).toBe('1 planned change(s) have no repo chosen.');
      // The agent's half names the pointer, the field and the legal values.
      // That is the difference between a one-op repair and the session that
      // spent its whole budget guessing at key names.
      expect(section?.detail).toContain('/technicalPlan/repos/1/repo');
      expect(section?.detail).toContain('ally-be, ally-web');
      expect(section?.detail).not.toContain('/technicalPlan/repos/0/repo');
      // Only the blockers list carries both, and only the agent reads it.
      expect(
        readiness.blockers.find((blocker) =>
          blocker.includes('no repo chosen'),
        ),
      ).toContain('/technicalPlan/repos/1/repo');
    });

    // The same session read the rubric as forbidding a cross-repo feature and
    // started spreading one change over five repos to satisfy it.
    it('tells the agent that one entry per repo is how a cross-repo change is written', () => {
      const draft = buildReadyPrd();
      draft.technicalPlan.repos = [
        { repo: '', changesMd: 'The same edit everywhere.' },
      ];

      const detail = service
        .computeReadiness(draft)
        .sections.find((entry) => entry.key === 'technicalPlan')?.detail;

      expect(detail).toContain('{repo, changesMd}');
      expect(detail).toContain('not a workaround');
    });

    it('points at the exact requirement missing criteria', () => {
      const draft = buildReadyPrd();
      draft.requirements = [
        {
          id: 'R1',
          title: 'PRD interview',
          description: 'Interviews the admin.',
          acceptanceCriteria: ['Options plus a custom field'],
        },
        {
          id: 'R2',
          title: 'Readiness ring',
          description: 'Scores the document.',
          acceptanceCriteria: [],
        },
      ];

      const section = service
        .computeReadiness(draft)
        .sections.find((entry) => entry.key === 'requirements');

      expect(section?.hint).toBe(
        '1 requirement(s) have no acceptance criteria.',
      );
      expect(section?.detail).toContain('/requirements/1/acceptanceCriteria');
      expect(section?.detail).toContain('Readiness ring');
      expect(section?.detail).not.toContain('/requirements/0/');
    });

    it('blocks a plan naming a repo Builder cannot work in', () => {
      const draft = buildReadyPrd();
      draft.technicalPlan.repos = [
        { repo: 'ally-be', changesMd: 'New src/builder module.' },
        { repo: 'some-other-repo', changesMd: 'Changes over there.' },
      ];

      const readiness = service.computeReadiness(draft);
      const section = readiness.sections.find(
        (entry) => entry.key === 'technicalPlan',
      );

      expect(readiness.ready).toBe(false);
      expect(section?.hint).toContain('some-other-repo');
      expect(section?.detail).toContain('Allowed values: ally-be');
    });

    it('treats a too-thin section differently from an empty one', () => {
      const draft = buildReadyPrd();
      draft.problem = 'It is slow.';

      const section = service
        .computeReadiness(draft)
        .sections.find((entry) => entry.key === 'problem');

      expect(section?.ok).toBe(false);
      expect(section?.hint).toContain('too thin');
    });
  });

  describe('applyPatch', () => {
    const docStub = () => ({
      id: 'doc-1',
      sessionId: 'session-1',
      draft: createEmptyPrdDocument(),
      versionNumber: 0,
    });

    it('rejects a patch whose path does not resolve, naming the operation', async () => {
      await expect(
        service.applyPatch(
          docStub() as any,
          [{ op: 'replace', path: '/nope/deeper', value: 'x' }],
          1,
          BuilderPrdVersionAuthor.AGENT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // A failed patch must not have reached the database at all.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('persists the patched draft and snapshots a version', async () => {
      const saved = { ...docStub(), versionNumber: 1 };
      const versionRepo = {
        create: jest.fn((v) => v),
        save: jest.fn(async (v) => v),
      };
      const docRepo = {
        findOneOrFail: jest
          .fn()
          .mockResolvedValueOnce(docStub())
          .mockResolvedValueOnce(saved),
        update: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (work: any) =>
        work({
          getRepository: (entity: any) =>
            entity?.name === 'BuilderPrdVersion' ? versionRepo : docRepo,
        }),
      );

      const result = await service.applyPatch(
        docStub() as any,
        [{ op: 'replace', path: '/summary', value: 'A Builder tab.' }],
        7,
        BuilderPrdVersionAuthor.ADMIN,
        'set summary',
      );

      expect(result.doc.versionNumber).toBe(1);
      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 1,
          author: BuilderPrdVersionAuthor.ADMIN,
          changeSummary: 'set summary',
          content: expect.objectContaining({ summary: 'A Builder tab.' }),
        }),
      );
      expect(docRepo.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ versionNumber: 1, updatedBy: 7 }),
      );
    });

    it('re-applies the patch to the post-race draft on a versionNumber collision, instead of overwriting it with stale content', async () => {
      // Simulates the admin editing `problem` while the agent's update_prd
      // tool call for `summary` is in flight: both compute nextVersionNumber
      // from the same starting point, one write wins outright, and the
      // other's transaction collides on (docId, versionNumber) and retries.
      const winningDraft = {
        ...createEmptyPrdDocument(),
        problem: 'Concurrent admin edit that must survive the retry.',
      };
      const raceWinnerDoc = {
        ...docStub(),
        draft: winningDraft,
        versionNumber: 1,
      };

      const versionRepo = {
        create: jest.fn((v) => v),
        save: jest
          .fn()
          .mockRejectedValueOnce({ code: '23505' })
          .mockImplementationOnce(async (v) => v),
      };
      const docRepo = {
        findOneOrFail: jest
          .fn()
          .mockResolvedValueOnce(docStub()) // attempt 1: current read
          .mockResolvedValueOnce(raceWinnerDoc) // attempt 2: current read, after the other writer committed
          .mockResolvedValueOnce({
            ...raceWinnerDoc,
            versionNumber: 2,
          }), // final read after the successful update
        update: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (work: any) =>
        work({
          getRepository: (entity: any) =>
            entity?.name === 'BuilderPrdVersion' ? versionRepo : docRepo,
        }),
      );

      await service.applyPatch(
        docStub() as any,
        [{ op: 'replace', path: '/summary', value: 'Agent edit.' }],
        7,
        BuilderPrdVersionAuthor.AGENT,
      );

      // The retried attempt must have applied the agent's patch on top of
      // the freshly-read (post-race) draft, not the one computed before the
      // collision — otherwise the admin's already-committed edit is silently
      // discarded by the retry's write.
      expect(versionRepo.save).toHaveBeenCalledTimes(2);
      const retriedContent = versionRepo.save.mock.calls[1][0].content;
      expect(retriedContent.problem).toBe(
        'Concurrent admin edit that must survive the retry.',
      );
      expect(retriedContent.summary).toBe('Agent edit.');
      expect(docRepo.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          draft: expect.objectContaining({
            problem: 'Concurrent admin edit that must survive the retry.',
            summary: 'Agent edit.',
          }),
        }),
      );
    });

    it('reports the coercions it had to make, so update_prd can hand them back', async () => {
      const versionRepo = {
        create: jest.fn((v) => v),
        save: jest.fn(async (v) => v),
      };
      const docRepo = {
        findOneOrFail: jest.fn().mockResolvedValue(docStub()),
        update: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (work: any) =>
        work({
          getRepository: (entity: any) =>
            entity?.name === 'BuilderPrdVersion' ? versionRepo : docRepo,
        }),
      );

      const { diagnostics } = await service.applyPatch(
        docStub() as any,
        [
          {
            op: 'add',
            path: '/technicalPlan/repos/-',
            value: { repoName: 'ally-be', changes: 'Lower the timeout.' },
          },
        ],
        7,
        BuilderPrdVersionAuthor.AGENT,
      );

      expect(diagnostics.recovered).toEqual([
        { path: '/technicalPlan/repos/0', wrote: 'repoName', storedAs: 'repo' },
        {
          path: '/technicalPlan/repos/0',
          wrote: 'changes',
          storedAs: 'changesMd',
        },
      ]);
      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            technicalPlan: expect.objectContaining({
              repos: [{ repo: 'ally-be', changesMd: 'Lower the timeout.' }],
            }),
          }),
        }),
      );
    });
  });

  /**
   * The technical design is drafted by a designer run and approved by a
   * person; the build is held to it. A patch from the interviewer or the
   * admin's section editor that could edit it would let an approved design
   * say something nobody approved.
   */
  describe('the technical design is not patchable', () => {
    const designed = () => ({
      id: 'doc-1',
      sessionId: 'session-1',
      draft: {
        ...createEmptyPrdDocument(),
        technicalDesign: { status: 'approved', designMd: 'approved words' },
      },
      versionNumber: 3,
    });

    it.each([
      ['replace', '/technicalDesign'],
      ['replace', '/technicalDesign/status'],
      ['add', '/technicalDesign/scope/-'],
      ['remove', '/technicalDesign'],
    ])('refuses %s %s, naming the operation', async (op, path) => {
      const attempt = service.applyPatch(
        designed() as any,
        [
          { op: 'replace', path: '/summary', value: 'fine' },
          { op: op as any, path, value: 'approved' },
        ],
        1,
        BuilderPrdVersionAuthor.AGENT,
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(
        /operation 1: \/technicalDesign cannot be edited here/,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('carries the stored design through a whole-document replace', async () => {
      const versionRepo = {
        create: jest.fn((v) => v),
        save: jest.fn(async (v) => v),
      };
      const docRepo = {
        findOneOrFail: jest.fn().mockResolvedValue(designed()),
        update: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (work: any) =>
        work({
          getRepository: (entity: any) =>
            entity?.name === 'BuilderPrdVersion' ? versionRepo : docRepo,
        }),
      );

      await service.applyPatch(
        designed() as any,
        [
          {
            op: 'replace',
            path: '',
            value: {
              ...createEmptyPrdDocument('Rewritten'),
              technicalDesign: null,
            },
          },
        ],
        1,
        BuilderPrdVersionAuthor.ADMIN,
      );

      const written = docRepo.update.mock.calls[0][1].draft;
      expect(written.title).toBe('Rewritten');
      expect(written.technicalDesign).toEqual(
        expect.objectContaining({ designMd: 'approved words' }),
      );
    });

    it('writes it through setTechnicalDesign, with a version like any edit', async () => {
      const versionRepo = {
        create: jest.fn((v) => v),
        save: jest.fn(async (v) => v),
      };
      const docRepo = {
        findOneOrFail: jest.fn().mockResolvedValue(designed()),
        update: jest.fn(),
      };
      dataSource.transaction.mockImplementation(async (work: any) =>
        work({
          getRepository: (entity: any) =>
            entity?.name === 'BuilderPrdVersion' ? versionRepo : docRepo,
        }),
      );

      await service.setTechnicalDesign(
        designed() as any,
        { status: 'failed', error: 'gone' } as any,
        9,
        BuilderPrdVersionAuthor.AGENT,
        'failed',
      );

      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 4,
          content: expect.objectContaining({
            technicalDesign: { status: 'failed', error: 'gone' },
          }),
        }),
      );
    });
  });

  /**
   * The rows that check what the PRD means. Each case is a defect session
   * 2bc3a5cf's v8 shipped to "ready" with.
   */
  describe('computeReadiness — meaning checks', () => {
    const row = (readiness: any, key: string) =>
      readiness.sections.find((section: any) => section.key === key);
    const at = (iso: string) => new Date(iso);

    it('leaves the signal-driven rows out when it has no signals', () => {
      const keys = service
        .computeReadiness(buildReadyPrd())
        .sections.map((section: any) => section.key);

      expect(keys).toEqual(
        expect.arrayContaining(['testPlanRepos', 'requirementHomes']),
      );
      for (const key of [
        'mobileTwins',
        'existingGrounded',
        'lastMessageApplied',
        'prdReview',
      ]) {
        expect(keys).not.toContain(key);
      }
    });

    it('blocks a test plan that tests a repo the plan does not change', () => {
      const draft = buildReadyPrd();
      draft.testPlanMd +=
        '\n- ally-ai: pytest for the challenger job in `ally-ai/tests/test_job.py`.';

      const readiness = service.computeReadiness(draft);

      expect(readiness.ready).toBe(false);
      expect(row(readiness, 'testPlanRepos').hint).toContain('ally-ai');
    });

    it('blocks a requirement no repo plans to build, naming it', () => {
      const draft = buildReadyPrd();
      draft.requirements.push({
        id: 'R2',
        title: 'Attribution',
        description: 'Record which prompt version wrote each debrief.',
        acceptanceCriteria: ['Each debrief stores its prompt version'],
      });

      const readiness = service.computeReadiness(draft);

      expect(row(readiness, 'requirementHomes').ok).toBe(false);
      expect(row(readiness, 'requirementHomes').detail).toContain(
        'R2 at /requirements/1',
      );
      // Score is about what is written; this row only blocks.
      expect(readiness.score).toBe(100);
    });

    describe('mobile twins', () => {
      const twins = [
        {
          name: 'DebriefTab',
          web: 'apps/ally-helpline-dashboard/src/DebriefTab.tsx',
          mobile: 'src/screens/DebriefTab.tsx',
        },
      ];
      const webOnly = () => {
        const draft = buildReadyPrd();
        draft.technicalPlan.repos = [
          { repo: 'ally-be', changesMd: 'Store the rating (R1).' },
          { repo: 'ally-web', changesMd: 'Thumbs in `DebriefTab` (R1).' },
        ];
        draft.whereChangesBelong =
          '- ally-be: storage.\n- ally-web: the control.';
        return draft;
      };

      it('blocks a change to a web screen mobile also has', () => {
        const readiness = service.computeReadiness(webOnly(), {
          parityTwins: twins,
        });

        expect(row(readiness, 'mobileTwins').ok).toBe(false);
        expect(row(readiness, 'mobileTwins').detail).toContain(
          'ally-mobile:src/screens/DebriefTab.tsx',
        );
      });

      it('passes once ally-mobile is planned or ruled out in non-goals', () => {
        const planned = webOnly();
        planned.technicalPlan.repos.push({
          repo: 'ally-mobile',
          changesMd: 'Thumbs in DebriefTab (R1).',
        });
        const ruledOut = webOnly();
        ruledOut.nonGoals = 'Mobile waits for the next app release.';

        expect(
          row(
            service.computeReadiness(planned, { parityTwins: twins }),
            'mobileTwins',
          ).ok,
        ).toBe(true);
        expect(
          row(
            service.computeReadiness(ruledOut, { parityTwins: twins }),
            'mobileTwins',
          ).ok,
        ).toBe(true);
      });
    });

    describe('what already exists was read', () => {
      const withExisting = (text: string) => {
        const draft = buildReadyPrd();
        draft.existingBehaviour = text;
        return draft;
      };

      it('blocks a section whose cited files only ever 404d', () => {
        const readiness = service.computeReadiness(
          withExisting(
            'The skill-experiment module handles this: see ' +
              '`src/skill-experiment/entities/skill-experiment.entity.ts`.',
          ),
          {
            evidence: {
              total: 4,
              readOk: [],
              readFailed: [
                'ally-be:src/skill-experiment/entities/skill-experiment.entity.ts',
              ],
            },
          },
        );

        expect(row(readiness, 'existingGrounded').ok).toBe(false);
        expect(row(readiness, 'existingGrounded').hint).toContain(
          "couldn't be read",
        );
      });

      it('passes when a cited path was read', () => {
        const readiness = service.computeReadiness(
          withExisting(
            'DEBRIEF_RUBRIC is defined in src/skill-experiment/constants/skill-experiment.constants.ts.',
          ),
          {
            evidence: {
              total: 2,
              readOk: [
                'ally-be:src/skill-experiment/constants/skill-experiment.constants.ts',
              ],
              readFailed: [],
            },
          },
        );

        expect(row(readiness, 'existingGrounded').ok).toBe(true);
      });

      it('asks for a citation when the section cites nothing', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          evidence: { total: 3, readOk: ['ally-be:src/a.ts'], readFailed: [] },
        });

        expect(row(readiness, 'existingGrounded').detail).toContain(
          'cites no file paths',
        );
      });

      it('skips a session from before the evidence log', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          evidence: { total: 0, readOk: [], readFailed: [] },
        });

        expect(row(readiness, 'existingGrounded')).toBeUndefined();
      });
    });

    describe("the admin's latest message", () => {
      it('blocks when it arrived after the last PRD change', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          lastAdminMessage: {
            text: 'Auto-improve already writes challengers — reuse it.',
            at: at('2026-10-20T10:05:00Z'),
          },
          lastPrdEditAt: at('2026-10-20T10:00:00Z'),
        });

        expect(readiness.ready).toBe(false);
        expect(row(readiness, 'lastMessageApplied').detail).toContain(
          'Auto-improve already writes challengers',
        );
      });

      it('passes once the PRD changed after it, or when there is none to apply', () => {
        const edited = service.computeReadiness(buildReadyPrd(), {
          lastAdminMessage: {
            text: 'Mobile too.',
            at: at('2026-10-20T10:05:00Z'),
          },
          lastPrdEditAt: at('2026-10-20T10:06:00Z'),
        });
        const none = service.computeReadiness(buildReadyPrd(), {
          lastAdminMessage: null,
          lastPrdEditAt: null,
        });

        expect(row(edited, 'lastMessageApplied').ok).toBe(true);
        expect(row(none, 'lastMessageApplied').ok).toBe(true);
      });
    });

    describe('cold review', () => {
      const finding = (status: 'open' | 'fixed' | 'dismissed') => ({
        id: 'F1',
        category: 'missing_success_metric' as const,
        section: 'goals',
        detail: 'No measurable outcome.',
        fix: 'Name the thumbs-up rate and who sets its target.',
        status,
        raisedInVersion: 8,
      });
      const review = (status: 'open' | 'fixed' | 'dismissed') => ({
        status: 'done' as const,
        versionNumber: 8,
        checkedVersion: 8,
        model: 'gpt-5-mini',
        reviewedAt: '2026-10-20T10:00:00Z',
        checkedAt: '2026-10-20T10:00:00Z',
        findings: [finding(status)],
      });

      it('blocks a PRD that is otherwise ready until the review has run', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          review: null,
        });

        expect(readiness.ready).toBe(false);
        expect(row(readiness, 'prdReview').hint).toContain("hasn't run");
      });

      it('says nothing about the review while other rows still block', () => {
        const draft = buildReadyPrd();
        draft.openQuestions = ['Who owns the target?'];

        const readiness = service.computeReadiness(draft, { review: null });

        expect(row(readiness, 'prdReview').ok).toBe(true);
        expect(readiness.blockers.join(' ')).not.toContain('review');
      });

      it('blocks on an open finding and hands the agent its fix', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          review: review('open'),
        });

        expect(readiness.ready).toBe(false);
        expect(row(readiness, 'prdReview').detail).toContain(
          'F1 [missing_success_metric, goals]',
        );
        expect(readiness.review?.findings[0].id).toBe('F1');
      });

      it.each(['fixed', 'dismissed'] as const)(
        'is ready once the finding is %s',
        (status) => {
          expect(
            service.computeReadiness(buildReadyPrd(), {
              review: review(status),
            }).ready,
          ).toBe(true);
        },
      );

      it('does not block when the reviewer itself failed', () => {
        const readiness = service.computeReadiness(buildReadyPrd(), {
          review: { ...review('open'), status: 'failed', findings: [] },
        });

        expect(readiness.ready).toBe(true);
      });
    });
  });
});
