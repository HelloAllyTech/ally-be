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
  goals: 'Turn a feature idea into reviewable pull requests without a handoff.',
  nonGoals: 'Not a replacement for code review; humans still merge.',
  testPlanMd:
    'Unit tests for the readiness rubric; an interview run end to end against a seeded admin.',
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
    repos: [{ repo: 'ally-be', changesMd: 'New src/builder module.' }],
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
});
