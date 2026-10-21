import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { BuilderPipelineController } from './builder-pipeline.controller';
import { BuilderBuildService } from '../service/builder-build.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderRunMode, BuilderStage } from '../enum/builder.enum';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderCatalogService } from '../service/builder-catalog.service';
import { BuilderEvidenceLogService } from '../service/builder-evidence-log.service';
import { createDraftingDesign } from '../util/builder-technical-design.util';

describe('BuilderPipelineController', () => {
  let app: INestApplication;
  let mockBuilderBuildService: Partial<BuilderBuildService>;
  let mockCatalogService: any;

  let mockBuilderSessionService: { getSession: jest.Mock };
  let mockPrdService: Record<string, jest.Mock>;
  let mockKnowledgeService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockBuilderSessionService = {
      getSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        currentStage: BuilderStage.FINALISING,
      }),
    };
    mockPrdService = {
      getOrCreateDoc: jest.fn(),
      setTechnicalDesign: jest.fn(),
    };
    mockKnowledgeService = {
      platformRules: jest
        .fn()
        .mockResolvedValue('## Platform rules\n\nBe additive.'),
      renderRepoPacks: jest.fn().mockResolvedValue(''),
    };
    mockCatalogService = {
      upsert: jest.fn(async (params: any) => ({
        repo: params.repo,
        entries: params.entries,
        generatedAt: new Date('2026-10-21T00:00:00Z'),
      })),
    };
    mockBuilderBuildService = {
      getRunOrFail: jest.fn().mockResolvedValue({
        id: uuidv4(),
        sessionId: uuidv4(),
        engine: null,
        model: null,
      }),
      settleRun: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BuilderPipelineController],
      providers: [
        { provide: BuilderBuildService, useValue: mockBuilderBuildService },
        // The ApiAuthGuard reads the key from config.
        { provide: AppConfigService, useValue: { apiKey: 'test-api-key' } },
        { provide: BuilderEventService, useValue: {} },
        { provide: BuilderPullRequestService, useValue: {} },
        { provide: BuilderKnowledgeService, useValue: mockKnowledgeService },
        { provide: BuilderPrdService, useValue: mockPrdService },
        { provide: BuilderSessionService, useValue: mockBuilderSessionService },
        { provide: BuilderCatalogService, useValue: mockCatalogService },
        {
          provide: BuilderEvidenceLogService,
          useValue: { renderForPrompt: jest.fn().mockResolvedValue('') },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // As main.ts has it, so the design DTOs are validated here as in prod.
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Builder's runner only drafts designs now. Any other run reaching
   * `complete` is the outcome gate settling a run whose engine exited, so a
   * failure always lands and a `done` has nothing to be checked against.
   */
  it('refuses a done from a run that is not a design run', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(409);

    expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
  });

  it('always records a failure', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'failed', error: 'no pull request was opened' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalledWith(
      expect.anything(),
      'FAILED',
      'no pull request was opened',
    );
  });

  /**
   * The catalog is posted by the context-refresh workflow. The endpoint keeps only the declared
   * keys of each entry and drops entries without a kind and a name — anything holding the
   * pipeline key can reach it.
   */
  it('stores a repo catalog, keeping only the declared keys', async () => {
    await request(app.getHttpServer())
      .post('/builder/pipeline/repo-catalogs')
      .set('x-api-key', 'test-api-key')
      .send({
        repo: 'ally-be',
        commitSha: 'abc123',
        entries: [
          {
            kind: 'module',
            name: 'skill-experiment',
            path: 'src/skill-experiment',
            extra: 'x',
          },
          { kind: 'table', path: 'no-name.ts' },
          { name: 'no-kind' },
        ],
        stats: { files: 10 },
      })
      .expect(201)
      .expect((res) =>
        expect(res.body).toMatchObject({
          ok: true,
          repo: 'ally-be',
          entries: 1,
        }),
      );

    expect(mockCatalogService.upsert).toHaveBeenCalledWith({
      repo: 'ally-be',
      commitSha: 'abc123',
      entries: [
        {
          kind: 'module',
          name: 'skill-experiment',
          path: 'src/skill-experiment',
        },
      ],
      stats: { files: 10 },
    });
  });

  it('refuses a catalog without the pipeline key', async () => {
    await request(app.getHttpServer())
      .post('/builder/pipeline/repo-catalogs')
      .send({ repo: 'ally-be', entries: [] })
      .expect(401);
  });

  /**
   * The technical design's runner half. The designer submits through the
   * `design` tool, the critic through `design_review`, and an issue build
   * reads the approved design back in its spec.
   */
  describe('technical design', () => {
    const designRunId = uuidv4();
    const draft: any = {
      title: 'Rich prompts',
      requirements: [{ id: 'R1', title: 'Bold', acceptanceCriteria: ['x'] }],
      technicalPlan: { repos: [], dataModelMd: '', apiMd: '' },
    };
    const withDesign = (design: Record<string, any> | null) => ({
      id: 'doc-1',
      draft: {
        ...draft,
        technicalDesign: design && {
          ...createDraftingDesign(draft, designRunId),
          ...design,
        },
      },
    });
    const submission = {
      designMd: 'Add an optional promptHtml beside prompt. '.repeat(10),
      scope: [{ repo: 'ally-be', files: ['src/quiz/**/*.ts'] }],
      contracts: [
        {
          name: 'payload.promptHtml',
          change: 'new optional key',
          readers: ['ally-mobile:src/screens/Quiz.tsx:88'],
        },
      ],
      compatibilityMd: 'prompt is unchanged.',
      testMap: [
        {
          requirementId: 'R1',
          repo: 'ally-be',
          file: 'src/quiz/test/quiz.spec.ts',
          asserts: 'stores it',
        },
      ],
      openDecisions: [],
    };

    beforeEach(() => {
      (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue({
        id: designRunId,
        sessionId: 'session-1',
        mode: BuilderRunMode.DESIGN,
      });
      mockBuilderSessionService.getSession.mockResolvedValue({
        id: 'session-1',
        createdBy: 4,
        repos: ['ally-be'],
        // Whatever the last build left behind; a design run never posts one.
        currentStage: BuilderStage.SETUP,
      });
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ status: 'drafting' }),
      );
      mockPrdService.setTechnicalDesign.mockImplementation(
        async (_doc, design) => ({
          doc: { draft: { ...draft, technicalDesign: design } },
        }),
      );
    });

    it('stores a submission in review and answers with what still blocks', async () => {
      const response = await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design`)
        .set('x-api-key', 'test-api-key')
        .send({ ...submission, openDecisions: ['Rename prompt?'] })
        .expect(201);

      // Status is left out: this call is what puts the design in review.
      expect(response.body).toEqual({
        ok: true,
        blockers: [expect.stringMatching(/1 open decision/)],
      });
      const [, stored] = mockPrdService.setTechnicalDesign.mock.calls[0];
      expect(stored).toEqual(
        expect.objectContaining({
          status: 'review',
          runId: designRunId,
          designMd: submission.designMd,
          openDecisions: ['Rename prompt?'],
          draftedAt: expect.any(String),
        }),
      );
      // Kept from the drafting record, not taken from the body.
      expect(stored.productHash).toBe(
        createDraftingDesign(draft, designRunId).productHash,
      );
    });

    it('answers with no blockers once the design is complete', async () => {
      const response = await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design`)
        .set('x-api-key', 'test-api-key')
        .send(submission)
        .expect(201);

      expect(response.body).toEqual({ ok: true, blockers: [] });
    });

    it('refuses a submission in the wrong shape', async () => {
      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design`)
        .set('x-api-key', 'test-api-key')
        .send({ ...submission, scope: [{ files: ['x.ts'] }] })
        .expect(400);

      expect(mockPrdService.setTechnicalDesign).not.toHaveBeenCalled();
    });

    it('refuses a submission from a run that is not a design run', async () => {
      (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue({
        id: designRunId,
        sessionId: 'session-1',
        mode: BuilderRunMode.BUILD,
      });

      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design`)
        .set('x-api-key', 'test-api-key')
        .send(submission)
        .expect(400);

      expect(mockPrdService.setTechnicalDesign).not.toHaveBeenCalled();
    });

    it('refuses a submission from a design run a newer draft replaced', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ status: 'drafting', runId: 'a-newer-run' }),
      );

      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design`)
        .set('x-api-key', 'test-api-key')
        .send(submission)
        .expect(409);

      expect(mockPrdService.setTechnicalDesign).not.toHaveBeenCalled();
    });

    it("stores the critic's verdict on the submitted design", async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ ...submission, status: 'review' }),
      );

      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design-review`)
        .set('x-api-key', 'test-api-key')
        .send({ verdict: 'concerns', notesMd: 'Missed a reader.' })
        .expect(201);

      const [, stored] = mockPrdService.setTechnicalDesign.mock.calls[0];
      expect(stored.review).toEqual({
        verdict: 'concerns',
        notesMd: 'Missed a reader.',
        at: expect.any(String),
      });
      expect(stored.status).toBe('review');
    });

    /**
     * Defects decide the verdict; suggestions never do. The first critic on
     * session 880e73e6 marked a sound design "concerns" for not adding rich
     * text to article questions, which the PRD never asked for.
     */
    it('derives the verdict from defects, and keeps suggestions apart', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ ...submission, status: 'review' }),
      );

      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design-review`)
        .set('x-api-key', 'test-api-key')
        // The reviewer's own verdict is overruled by its empty defect list.
        .send({
          verdict: 'concerns',
          defects: [],
          suggestions: ['Article questions could take rich text too.'],
        })
        .expect(201);

      const [, passed] = mockPrdService.setTechnicalDesign.mock.calls[0];
      expect(passed.review).toEqual({
        verdict: 'pass',
        notesMd: '',
        defects: [],
        suggestions: ['Article questions could take rich text too.'],
        at: expect.any(String),
      });

      mockPrdService.setTechnicalDesign.mockClear();
      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/design-review`)
        .set('x-api-key', 'test-api-key')
        .send({
          defects: ['ally-be:src/a.ts:9 reads prompt and is not listed'],
          suggestions: [],
        })
        .expect(201);

      const [, failed] = mockPrdService.setTechnicalDesign.mock.calls[0];
      expect(failed.review.verdict).toBe('concerns');
    });

    it('serves an issue build its spec: rules and the PRD with the approved design, no protocol', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ ...submission, status: 'approved' }),
      );

      const response = await request(app.getHttpServer())
        .get(`/builder/pipeline/runs/${designRunId}/spec`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.text).toContain('Technical design (approved)');
      expect(response.text).not.toContain('## Tools');
    });

    it('renders the design prompt with the rules, the PRD and the tool contract', async () => {
      const response = await request(app.getHttpServer())
        .get(`/builder/pipeline/runs/${designRunId}/prompt`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.text).toContain('Be additive.');
      expect(response.text).toContain('# PRD — Rich prompts');
      expect(response.text).toContain('`design`');
    });

    it('serves the platform rules on their own', async () => {
      const response = await request(app.getHttpServer())
        .get('/builder/pipeline/platform-rules')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.text).toContain('Be additive.');
    });

    /**
     * A design run never posts a stage, so `currentStage` is whatever the last
     * build left — SETUP here — and must not refuse it. It has no gate either.
     */
    it('completes a design run that submitted, from any stage, with no gate', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ ...submission, status: 'review' }),
      );

      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/complete`)
        .set('x-api-key', 'test-api-key')
        .send({ outcome: 'done' })
        .expect(201);

      expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
    });

    it('refuses done from a design run that never submitted a design', async () => {
      await request(app.getHttpServer())
        .post(`/builder/pipeline/runs/${designRunId}/complete`)
        .set('x-api-key', 'test-api-key')
        .send({ outcome: 'done' })
        .expect(409);

      expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
    });
  });
  describe('an in-repo review filing its verdict', () => {
    const filing = { pullRequestId: 'pr-114', findings: [] };
    let controller: BuilderPipelineController;

    beforeEach(() => {
      controller = app.get(BuilderPipelineController);
      (controller as any).pullRequestService = {
        recordReviewFindings: jest.fn().mockResolvedValue(0),
      };
      mockBuilderBuildService.settleRepoReview = jest.fn();
    });

    it('settles the review run: its verdict is its end', async () => {
      const run = { id: 'review-1', sessionId: 'session-1' };
      (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue(
        run,
      );
      mockBuilderBuildService.isRepoReview = jest.fn().mockReturnValue(true);

      await expect(
        controller.recordReviewFindings('review-1', filing as any),
      ).resolves.toEqual({ ok: true, recorded: 0 });

      expect(mockBuilderBuildService.settleRepoReview).toHaveBeenCalledWith(
        run,
        'SUCCEEDED',
        null,
      );
    });

    it('leaves a run that is not an in-repo review unsettled', async () => {
      (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue({
        id: 'review-2',
        sessionId: 'session-1',
      });
      mockBuilderBuildService.isRepoReview = jest.fn().mockReturnValue(false);

      await controller.recordReviewFindings('review-2', filing as any);

      expect(mockBuilderBuildService.settleRepoReview).not.toHaveBeenCalled();
    });
  });
});
