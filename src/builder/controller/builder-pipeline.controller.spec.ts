import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { BuilderPipelineController } from './builder-pipeline.controller';
import { BuilderBuildService } from '../service/builder-build.service';
import { RecordBuilderRunModelDto } from '../dto/builder-pipeline.dto';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderSteerService } from '../service/builder-steer.service';
import { BuilderRunMode, BuilderStage } from '../enum/builder.enum';
import { BuilderQuestionService } from '../service/builder-question.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderReportService } from '../service/builder-report.service';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderExemplarService } from '../service/builder-exemplar.service';
import { BuilderEpicService } from '../service/builder-epic.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import {
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { createDraftingDesign } from '../util/builder-technical-design.util';

describe('BuilderPipelineController', () => {
  let app: INestApplication;
  let mockBuilderBuildService: Partial<BuilderBuildService>;

  let mockBuilderSessionService: { getSession: jest.Mock };
  let mockPrdService: Record<string, jest.Mock>;
  let mockKnowledgeService: Record<string, jest.Mock>;

  beforeEach(async () => {
    // Defaults to a stage a run may legitimately finish from, so the
    // completion tests that are not about staging stay unaffected.
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
    mockBuilderBuildService = {
      getRunOrFail: jest.fn().mockResolvedValue({
        id: uuidv4(),
        sessionId: uuidv4(),
        engine: null,
        model: null,
      }),
      recordRunModel: jest.fn().mockResolvedValue(undefined),
      touchedNoFiles: jest.fn().mockResolvedValue(false),
      hasPassingGate: jest.fn().mockResolvedValue(false),
      settleRun: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BuilderPipelineController],
      providers: [
        { provide: BuilderBuildService, useValue: mockBuilderBuildService },
        { provide: AppConfigService, useValue: { apiKey: 'test-api-key' } },
        {
          provide: LoggerService,
          useValue: {
            getInstance: () => ({
              warn: jest.fn(),
              error: jest.fn(),
              info: jest.fn(),
            }),
          },
        },
        { provide: PromptSharedService, useValue: {} },
        { provide: BuilderEventService, useValue: {} },
        { provide: BuilderSteerService, useValue: {} },
        { provide: BuilderQuestionService, useValue: {} },
        { provide: BuilderPullRequestService, useValue: {} },
        {
          provide: BuilderReportService,
          useValue: {
            composeSessionReport: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: BuilderSettingsService, useValue: {} },
        { provide: BuilderExemplarService, useValue: {} },
        { provide: BuilderEpicService, useValue: {} },
        { provide: BuilderKnowledgeService, useValue: mockKnowledgeService },
        { provide: BuilderPrdService, useValue: mockPrdService },
        { provide: BuilderSessionService, useValue: mockBuilderSessionService },
        { provide: BuilderBuildRunRepository, useValue: {} },
        { provide: BuilderQuestionRepository, useValue: {} },
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
   * A `done` the gate cannot corroborate is refused — and the run is left
   * alone. It used to be settled FAILED, on the assumption that such a claim
   * came from an agent about to exit; it also arrives from one that completed
   * too early, mid-pipeline, before the gate it was claiming had run. The run
   * then carried on to a real pull request behind a session already painted
   * red. Anything that does go on to quit is caught by outcome-gate.sh, which
   * settles whatever is still RUNNING when the engine exits.
   */
  it('refuses a done with no passing gate without ending the run', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(409);

    expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
  });

  it('settles a done the gate corroborates', async () => {
    (mockBuilderBuildService.hasPassingGate as jest.Mock).mockResolvedValue(
      true,
    );
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  /**
   * A plan is not an outcome.
   *
   * On 2026-09-24 a build's PLANNING agent finished its plan and called
   * `complete_run done`. It was accepted — a planner edits no files, so the
   * `changedNothing` exemption waved the gate requirement through — and the
   * run was settled before the coder had started. Thirty-four minutes later
   * the workflow failed with no pull request.
   */
  it('refuses a build that reports done from PLANNING', async () => {
    (mockBuilderSessionService.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      currentStage: BuilderStage.PLANNING,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(409);

    expect(mockBuilderBuildService.settleRun).not.toHaveBeenCalled();
    // Not even asked: the stage settles it before the file check can excuse it.
    expect(mockBuilderBuildService.touchedNoFiles).not.toHaveBeenCalled();
  });

  /**
   * A failure from an early stage is still a failure. The runner reports these
   * from evidence after the agent has gone, and losing one strands the run.
   */
  it('still records a failure reported from PLANNING', async () => {
    (mockBuilderSessionService.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      currentStage: BuilderStage.PLANNING,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'failed', error: 'the planner could not read the PRD' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  /**
   * A REVIEW run has no gate to pass, so requiring one made a correct review
   * impossible to complete.
   *
   * On 2026-09-23 a review of ally-web#694 reported zero findings, approved
   * the pull request, and was then refused its own completion twice and failed
   * by outcome-gate.sh — recorded as a failed run for doing exactly its job,
   * and announced to Slack as one, because BUILD_FAILED is an announced kind.
   */
  it('settles a review that has no gate to pass', async () => {
    (mockBuilderBuildService.getRunOrFail as jest.Mock).mockResolvedValue({
      id: uuidv4(),
      sessionId: uuidv4(),
      engine: null,
      model: null,
      mode: BuilderRunMode.REVIEW,
    });
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'done' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
    // The gate is not merely tolerated when absent — it is never asked for.
    expect(mockBuilderBuildService.hasPassingGate).not.toHaveBeenCalled();
  });

  /**
   * A failure needs no gate behind it — the runner reports these from evidence
   * after the agent has finished, and they must always land.
   */
  it('always records a failure', async () => {
    const runId = uuidv4();

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/complete`)
      .set('x-api-key', 'test-api-key')
      .send({ outcome: 'failed', error: 'no pull request was opened' })
      .expect(201);

    expect(mockBuilderBuildService.settleRun).toHaveBeenCalled();
  });

  it('should record the model for a run', async () => {
    const runId = uuidv4();
    const model = 'test-model';
    // Non-null asserted: the mock is a Partial<BuilderBuildService>, so every
    // member is optional to the type checker even though this one is always
    // provided in beforeEach. Without it the Docker build fails on a strict
    // type error that ts-jest does not raise.
    const mockRun = await mockBuilderBuildService.getRunOrFail!(runId);

    const dto: RecordBuilderRunModelDto = { model };

    await request(app.getHttpServer())
      .post(`/builder/pipeline/runs/${runId}/model`)
      .set('x-api-key', 'test-api-key') // Add API key for authentication
      .send(dto)
      .expect(201)
      .expect({ ok: true });

    expect(mockBuilderBuildService.getRunOrFail).toHaveBeenCalledWith(runId);
    expect(mockBuilderBuildService.recordRunModel).toHaveBeenCalledWith(
      mockRun,
      dto,
    );
  });

  /**
   * The technical design's runner half. The designer submits through the
   * `design` tool, the critic through `design_review`, and builds read the
   * approved scope back for their scope gate.
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

    it('serves the approved scope per repo', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({
          ...submission,
          status: 'approved',
          scope: [
            { repo: 'ally-be', files: ['src/a.ts'] },
            { repo: 'ally-web', files: ['src/b.tsx'] },
          ],
        }),
      );

      const response = await request(app.getHttpServer())
        .get(`/builder/pipeline/runs/${designRunId}/design-scope`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual({
        repos: { 'ally-be': ['src/a.ts'], 'ally-web': ['src/b.tsx'] },
      });
    });

    it('serves no scope for a design nobody approved', async () => {
      mockPrdService.getOrCreateDoc.mockResolvedValue(
        withDesign({ ...submission, status: 'review' }),
      );

      const response = await request(app.getHttpServer())
        .get(`/builder/pipeline/runs/${designRunId}/design-scope`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body).toEqual({ repos: {} });
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
      expect(mockBuilderBuildService.hasPassingGate).not.toHaveBeenCalled();
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
});
