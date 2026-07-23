import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { AgentTestCase } from 'src/learn/entity/agent-test-case.entity';
import { AgentTestCaseType } from 'src/learn/enum/agent-test-case.enum';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { TIME } from 'src/common/constants/time.constants';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplayTestRun } from '../entity/roleplay-test-run.entity';
import { RoleplayTestReport } from '../entity/roleplay-test-report.entity';
import {
  RoleplayReportImproveStatus,
  RoleplayTestReportStatus,
  RoleplayTestRunStatus,
} from '../enum/roleplay-test-run.enum';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { RoleplayTestRunRepository } from '../repository/roleplay-test-run.repository';
import {
  RoleplayTestReportListItem,
  RoleplayTestReportRepository,
} from '../repository/roleplay-test-report.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { CopilotSessionService } from './copilot-session.service';
import { SpecCompilerService } from './spec-compiler.service';
import { SpecValidatorService } from './spec-validator.service';
import {
  CreateTestRunDto,
  UpdateTestRunWebhookDto,
} from '../dto/roleplay-test-run.dto';
import {
  IMPROVE_REDIS_KEY_PREFIX,
  TEST_REPORT_END_STATUSES,
  TEST_RUN_DEFAULT_TURNS_PER_CASE,
  TEST_RUN_END_STATUSES,
  TEST_RUN_MAX_CASES,
  TEST_RUN_PENDING_STATUSES,
  TEST_RUN_REDIS_KEY_PREFIX,
} from '../constants/roleplay-studio.constants';
import { SPEC_SCHEMA_VERSION } from '../type/roleplay-spec-document.type';
import {
  RoleplayTestCaseSnapshot,
  RoleplayTestRunWireTestCase,
} from '../type/roleplay-test-run-request.type';

/** Optional re-run wiring for createTestRun (auto-improve path). */
interface CreateTestRunOptions {
  /** Parent report this run re-tests — child reports get improveOfReportId. */
  sourceReportId?: string;
  /** Replay these snapshots instead of re-reading agent_test_cases. */
  testCaseSnapshotsOverride?: RoleplayTestCaseSnapshot[];
  /** Pin an existing version (re-runs) instead of snapshotting the draft. */
  specVersionId?: string;
}

/**
 * Improve test-run lifecycle — a lean, trainer-driven port of the deleted
 * rehearsal harness (007617d6^): one non-terminal run per spec, redis TTL
 * watchdog, ai-learn trigger/cancel, webhook updates with one-way end
 * statuses, one report row per agent test case, and the auto-improve bridge
 * that feeds a report through the copilot and re-runs its case.
 */
@Injectable()
export class RoleplayTestRunService {
  private readonly logger = LoggerService.getInstance(
    RoleplayTestRunService.name,
  );

  constructor(
    private readonly testRunRepository: RoleplayTestRunRepository,
    private readonly testReportRepository: RoleplayTestReportRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly copilotSessionService: CopilotSessionService,
    private readonly specCompiler: SpecCompilerService,
    private readonly specValidator: SpecValidatorService,
    private readonly permissionsService: PermissionsService,
    private readonly aiService: AiService,
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
    // AgentTestCase lives in LearnModule (not imported here); reach its
    // repository through the app DataSource — same pattern as
    // SpecValidatorService.
    private readonly dataSource: DataSource,
  ) {}

  private get timeoutMinutes(): number {
    return this.configService.roleplayStudio.testRunTimeoutMinutes;
  }

  // ------------------------------------------------------------------ start

  async createTestRun(
    specId: string,
    dto: CreateTestRunDto,
    userId: number,
    options: CreateTestRunOptions = {},
  ): Promise<{ run: RoleplayTestRun; reports: RoleplayTestReport[] }> {
    const spec = await this.roleplaySpecService.getSpec(specId);
    await this.assertSpecOwnership(spec, userId);

    // A test run of an invalid draft would only measure noise. Re-runs pin an
    // existing (already-run) version instead, so they skip the draft check.
    if (!options.specVersionId) {
      const validation = await this.specValidator.validate(spec.draftSpec);
      if (!validation.valid) {
        throw new UnprocessableEntityException({
          message: 'Spec draft failed validation; fix it before running tests',
          errors: validation.errors,
        });
      }
    }

    // One live run per spec at a time (also serializes auto-improve re-runs).
    const pending = await this.testRunRepository.findPendingForSpec(specId);
    if (pending.length > 0) {
      throw new BadRequestException(
        'A test run is already in progress for this spec',
      );
    }

    // Pin the exact document under test: the copilot's output version on
    // re-runs, otherwise a fresh versions-only snapshot of the draft (doesn't
    // touch roleplay_specs.draftSpec, so the FE concurrency token is safe).
    const version = options.specVersionId
      ? await this.roleplaySpecService.getVersion(specId, options.specVersionId)
      : await this.roleplaySpecService.appendVersionSnapshot(
          specId,
          spec.draftSpec,
          userId,
          RoleplaySpecVersionSource.TEST_RUN,
        );

    const testCases =
      options.testCaseSnapshotsOverride ??
      (await this.loadTestCaseSnapshots(dto.agentTestCaseIds ?? []));
    if (testCases.length === 0) {
      throw new BadRequestException('Select at least one agent test case');
    }
    if (testCases.length > TEST_RUN_MAX_CASES) {
      throw new BadRequestException(
        `A test run can exercise at most ${TEST_RUN_MAX_CASES} test cases; ` +
          `got ${testCases.length}`,
      );
    }

    const config = {
      // Snapshots (camelCase keys in storage, snake_case on the wire): the
      // agent_test_cases table is global + hard-deleted, so historical runs
      // must stay self-describing.
      testCases,
      turnsPerCase: dto.turnsPerCase ?? TEST_RUN_DEFAULT_TURNS_PER_CASE,
      languageId:
        dto.languageId ??
        (version.spec as Record<string, any>)?.language?.languageId,
      judgeModel: dto.judgeModel ?? null,
      traineeModel: dto.traineeModel ?? null,
      // Units run serially in ai-learn — scale the watchdog with the load
      // (3 units ≙ the baseline the default timeout was sized for).
      timeoutMinutes: this.timeoutMinutes * Math.ceil(testCases.length / 3),
    };

    const { run, reports } = await this.dataSource.transaction(async (em) => {
      const runRepo = em.getRepository(RoleplayTestRun);
      const reportRepo = em.getRepository(RoleplayTestReport);
      const createdRun = await runRepo.save(
        runRepo.create({
          specId: spec.id,
          specVersionId: version.id,
          status: RoleplayTestRunStatus.STARTED,
          config,
          sourceReportId: options.sourceReportId ?? null,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
      const createdReports = await reportRepo.save(
        testCases.map((testCase) =>
          reportRepo.create({
            runId: createdRun.id,
            specId: spec.id,
            specVersionId: version.id,
            agentTestCaseId: testCase.id,
            testCaseSnapshot: testCase,
            status: RoleplayTestReportStatus.PENDING,
            improveOfReportId: options.sourceReportId ?? null,
            createdBy: userId,
            updatedBy: userId,
          }),
        ),
      );
      return { run: createdRun, reports: createdReports };
    });

    // TTL watchdog (scenario-report pattern): key expiry fails stuck runs.
    await this.redisService.set(
      `${TEST_RUN_REDIS_KEY_PREFIX}:${run.id}`,
      run.id,
      config.timeoutMinutes * 60,
    );

    await this.triggerTestRun(run, version.spec as Record<string, any>);
    // Re-read the report rows post-trigger: a synchronous trigger failure has
    // already FAILED the run AND its PENDING reports, and the in-memory
    // pre-trigger snapshot would contradict the DB in the response.
    const freshReports = await this.testReportRepository.find({
      where: { id: In(reports.map((report) => report.id)) },
    });
    const byId = new Map(freshReports.map((report) => [report.id, report]));
    return {
      run: await this.getRun(run.id),
      reports: reports.map((report) => byId.get(report.id) ?? report),
    };
  }

  /**
   * Fetch + validate the selected agent test cases and snapshot the full
   * shape {id,title,type,tags,description,condition,test,rubrics} preserving
   * the request order. Invalid selections 400 with EVERY offending id
   * (unknown ids, condition cases missing condition/test, full_session cases
   * without a usable rubric) — never silently skipped.
   */
  private async loadTestCaseSnapshots(
    ids: string[],
  ): Promise<RoleplayTestCaseSnapshot[]> {
    if (ids.length === 0) {
      return [];
    }
    const found = await this.dataSource
      .getRepository(AgentTestCase)
      .find({ where: { id: In(ids) } });
    const byId = new Map(found.map((testCase) => [testCase.id, testCase]));

    const missing = ids.filter((id) => !byId.has(id));
    const invalid = ids.filter((id) => {
      const testCase = byId.get(id);
      if (!testCase) return false;
      if (testCase.type === AgentTestCaseType.FULL_SESSION) {
        const rubrics = testCase.rubrics ?? [];
        return (
          rubrics.length === 0 ||
          rubrics.some((rubric) => !rubric.criteria?.trim())
        );
      }
      return !testCase.condition?.trim() || !testCase.test?.trim();
    });
    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`unknown agent test case ids: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      problems.push(
        `agent test cases missing a condition/test or usable rubric: ` +
          invalid.join(', '),
      );
    }
    if (problems.length > 0) {
      throw new BadRequestException(
        `Invalid agent test case selection — ${problems.join('; ')}`,
      );
    }

    return ids.map((id) => {
      const testCase = byId.get(id)!;
      return {
        id: testCase.id,
        title: testCase.title,
        type: testCase.type,
        tags: testCase.tags ?? [],
        description: testCase.description ?? null,
        condition: testCase.condition ?? null,
        test: testCase.test ?? null,
        rubrics: testCase.rubrics ?? null,
      };
    });
  }

  private toWireTestCase(
    snapshot: RoleplayTestCaseSnapshot,
  ): RoleplayTestRunWireTestCase {
    return {
      id: snapshot.id,
      title: snapshot.title,
      type: snapshot.type,
      condition: snapshot.condition ?? null,
      test: snapshot.test ?? null,
      ...(snapshot.rubrics && snapshot.rubrics.length > 0
        ? {
            rubrics: snapshot.rubrics.map((rubric) => ({
              criteria: rubric.criteria,
              scoring_instructions: rubric.scoringInstructions,
            })),
          }
        : {}),
    };
  }

  private async triggerTestRun(
    run: RoleplayTestRun,
    specDocument: Record<string, any>,
  ): Promise<void> {
    try {
      await this.aiService.triggerRoleplayTestRun({
        rehearsal_id: run.id,
        spec: this.specCompiler.compile(specDocument),
        spec_schema_version:
          specDocument.specSchemaVersion ?? SPEC_SCHEMA_VERSION,
        config: {
          trainee_profiles: [],
          turns_per_profile: run.config.turnsPerCase,
          language_id: run.config.languageId,
          judge_model: run.config.judgeModel,
          trainee_model: run.config.traineeModel,
          test_cases: (run.config.testCases ?? []).map(
            (snapshot: RoleplayTestCaseSnapshot) =>
              this.toWireTestCase(snapshot),
          ),
        },
      });

      // Late-webhook guard: never flip a run that already ended.
      const current = await this.testRunRepository.findOne({
        where: { id: run.id },
      });
      if (current && !TEST_RUN_END_STATUSES.includes(current.status)) {
        await this.testRunRepository.update(run.id, {
          status: RoleplayTestRunStatus.IN_PROGRESS,
          updatedBy: run.updatedBy,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Test-run trigger failed for run ${run.id}: ${message}`,
      );
      await this.testRunRepository.update(run.id, {
        status: RoleplayTestRunStatus.FAILED,
        metadata: { errorMessage: message } as Record<string, any>,
        endedAt: new Date(),
        updatedBy: run.updatedBy,
      });
      await this.finalizeEndedRun(run.id);
    }
  }

  // ------------------------------------------------------------------ reads

  async getRun(runId: string): Promise<RoleplayTestRun> {
    const run = await this.testRunRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Test run not found');
    }
    return run;
  }

  async listReports(
    specId: string,
    userId: number,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ data: RoleplayTestReportListItem[]; count: number }> {
    const spec = await this.roleplaySpecService.getSpec(specId);
    await this.assertSpecOwnership(spec, userId);
    return this.testReportRepository.listBySpec(specId, options);
  }

  async getReport(
    reportId: string,
    userId: number,
  ): Promise<RoleplayTestReport> {
    const report = await this.getReportRow(reportId);
    const spec = await this.roleplaySpecService.getSpec(report.specId);
    await this.assertSpecOwnership(spec, userId);
    return report;
  }

  private async getReportRow(reportId: string): Promise<RoleplayTestReport> {
    const report = await this.testReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundException('Test report not found');
    }
    return report;
  }

  // ----------------------------------------------------------------- cancel

  async cancelRun(runId: string, userId: number): Promise<SuccessResponse> {
    const run = await this.getRun(runId);
    const spec = await this.roleplaySpecService.getSpec(run.specId);
    await this.assertSpecOwnership(spec, userId);
    if (TEST_RUN_END_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        'Cannot cancel a test run that is already completed, cancelled, or failed',
      );
    }

    // Durable CANCELLED first — a late webhook is ignored by the end-status
    // guard even if the propagation to ai-learn fails.
    await this.testRunRepository.update(runId, {
      status: RoleplayTestRunStatus.CANCELLED,
      endedAt: new Date(),
      updatedBy: userId,
    });
    await this.finalizeEndedRun(runId);

    // Best-effort propagation so ai-learn stops burning tokens.
    await this.aiService.triggerRoleplayTestRunCancel(runId);
    return { success: true };
  }

  // ---------------------------------------------------------------- webhook

  /**
   * ai-learn progress/result webhook. End statuses are one-way (a late
   * webhook can't flip COMPLETED/FAILED/CANCELLED back), but additive data —
   * per-case results, aggregate summary, report — is always accepted,
   * mirroring the scenario-report guard.
   */
  async updateFromWebhook(
    runId: string,
    dto: UpdateTestRunWebhookDto,
  ): Promise<RoleplayTestRun> {
    this.logger.info(
      `Test-run webhook for ${runId} with status: ${dto.status}`,
    );
    const run = await this.getRun(runId);
    const statusLocked = TEST_RUN_END_STATUSES.includes(run.status);

    // The wire payload always carries results:null and report_markdown:""
    // on IN_PROGRESS/FAILED/CANCELLED PATCHes (and the FAILED backstop sends
    // a degenerate {completed:0,total:0} progress) — treat those as absent so
    // they never overwrite stored values.
    const updatePayload: Partial<RoleplayTestRun> = {};
    if (dto.progress && dto.progress.total > 0) {
      updatePayload.progress = dto.progress;
    }
    if (dto.results) updatePayload.resultsSummary = dto.results;
    if (typeof dto.report_markdown === 'string' && dto.report_markdown) {
      updatePayload.reportMarkdown = dto.report_markdown;
    }
    if (dto.error_message) {
      updatePayload.metadata = {
        ...(run.metadata ?? {}),
        errorMessage: dto.error_message,
      };
    }
    if (dto.status !== undefined && !statusLocked) {
      updatePayload.status = dto.status;
      if (TEST_RUN_END_STATUSES.includes(dto.status)) {
        updatePayload.endedAt = new Date();
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.testRunRepository.update(runId, updatePayload);
    }

    if (dto.transcripts && dto.transcripts.length > 0) {
      await this.applyTranscriptDeliveries(runId, dto.transcripts);
    }

    // Only a REAL transition into an end status finalizes the run — a locked
    // (already-ended) run's late webhook must not re-fire the cleanup.
    if (
      !statusLocked &&
      updatePayload.status !== undefined &&
      TEST_RUN_END_STATUSES.includes(updatePayload.status)
    ) {
      await this.finalizeEndedRun(runId);
    }
    return this.getRun(runId);
  }

  /**
   * Per-unit deliveries: entries carrying `test_case_id` fill the report row
   * keyed (runId, agentTestCaseId). Terminal report rows are never rewritten
   * (re-deliveries are ignored); rows are marked COMPLETED with the judge's
   * verdict/scores and ai-learn's per-unit markdown — or FAILED when the
   * judge itself fell back (test_result.judge_failed).
   */
  private async applyTranscriptDeliveries(
    runId: string,
    transcripts: Record<string, any>[],
  ): Promise<void> {
    for (const entry of transcripts) {
      if (!entry.test_case_id) {
        // trainee_profiles is always [] for test runs; profile entries are
        // unexpected and carry no report row to fill.
        this.logger.warn(
          `Test-run ${runId} webhook delivered a non-test-case transcript ` +
            `(trainee_profile=${entry.trainee_profile ?? 'unknown'}); ignored`,
        );
        continue;
      }
      const agentTestCaseId = String(entry.test_case_id);
      const report = await this.testReportRepository.findByRunAndCase(
        runId,
        agentTestCaseId,
      );
      if (!report) {
        this.logger.warn(
          `Test-run ${runId} webhook delivered results for unknown test ` +
            `case ${agentTestCaseId}; ignored`,
        );
        continue;
      }
      if (TEST_REPORT_END_STATUSES.includes(report.status)) {
        continue;
      }

      const testResult = (entry.test_result ?? null) as Record<
        string,
        any
      > | null;
      // Absent scores stay null — Number(null) is 0, which would fake a
      // legitimate 0-score on every condition case.
      const rawOverallScore = testResult?.overall_score;
      const overallScore =
        typeof rawOverallScore === 'number' && Number.isFinite(rawOverallScore)
          ? rawOverallScore
          : null;
      // ai-learn sets test_result.judge_failed when the judge LLM call fell
      // back — the evidence is still worth storing, but the row must read
      // FAILED so a judge outage is never mistaken for a real verdict/score.
      const judgeFailed = testResult?.judge_failed === true;
      await this.testReportRepository.update(report.id, {
        status: judgeFailed
          ? RoleplayTestReportStatus.FAILED
          : RoleplayTestReportStatus.COMPLETED,
        transcript: Array.isArray(entry.transcript) ? entry.transcript : [],
        directorTrace: entry.director_trace ?? null,
        judgeScores: entry.judge_scores ?? null,
        judgeNotes: entry.judge_notes ?? null,
        testResult,
        verdict:
          typeof testResult?.verdict === 'string' ? testResult.verdict : null,
        overallScore,
        reportMarkdown:
          typeof entry.unit_report_markdown === 'string' &&
          entry.unit_report_markdown
            ? entry.unit_report_markdown
            : (report.reportMarkdown ?? null),
        endedAt: new Date(),
      });
    }
  }

  /**
   * Run-ended cleanup (idempotent): undelivered PENDING reports inherit the
   * terminal status, the watchdog key is dropped, and — for auto-improve
   * re-runs — the parent report's RERUNNING is closed out as DONE.
   */
  private async finalizeEndedRun(runId: string): Promise<void> {
    const run = await this.testRunRepository.findOne({ where: { id: runId } });
    if (!run) return;
    const reportEndStatus =
      run.status === RoleplayTestRunStatus.CANCELLED
        ? RoleplayTestReportStatus.CANCELLED
        : RoleplayTestReportStatus.FAILED;
    await this.testReportRepository.update(
      { runId: run.id, status: RoleplayTestReportStatus.PENDING },
      { status: reportEndStatus, endedAt: new Date() },
    );
    await this.redisService.del(`${TEST_RUN_REDIS_KEY_PREFIX}:${run.id}`);
    if (run.sourceReportId) {
      await this.transitionImproveStatus(
        run.sourceReportId,
        RoleplayReportImproveStatus.RERUNNING,
        RoleplayReportImproveStatus.DONE,
      );
    }
  }

  // ---------------------------------------------------------------- timeouts

  /** Redis-TTL expiry hook: fail the run if it outlived the timeout. */
  async handleExpiredRun(runId: string): Promise<void> {
    const run = await this.testRunRepository.findOne({ where: { id: runId } });
    if (!run || TEST_RUN_END_STATUSES.includes(run.status)) {
      return;
    }
    // Per-run timeout scales with the unit count; class default covers rows
    // created before config.timeoutMinutes existed.
    const timeoutMinutes = run.config?.timeoutMinutes ?? this.timeoutMinutes;
    const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
    if (run.createdAt > cutoff) {
      return;
    }
    const result = await this.testRunRepository.update(
      { id: runId, status: In(TEST_RUN_PENDING_STATUSES) },
      {
        status: RoleplayTestRunStatus.FAILED,
        metadata: { errorMessage: 'Failed due to timeout' } as Record<
          string,
          any
        >,
        endedAt: new Date(),
      },
    );
    if (result.affected && result.affected > 0) {
      this.logger.info(
        `Marked test run ${runId} as FAILED due to TTL expiration`,
      );
      await this.finalizeEndedRun(runId);
    }
  }

  /**
   * Watchdog for auto-improve turns stuck IMPROVING (server died mid-turn),
   * plus the narrower crash window where IMPROVING→RERUNNING committed but
   * the server died before createTestRun — no child run exists, so nothing
   * would ever close RERUNNING out via finalizeEndedRun.
   */
  async handleExpiredImprove(reportId: string): Promise<void> {
    const report = await this.testReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      return;
    }
    if (report.improveStatus === RoleplayReportImproveStatus.IMPROVING) {
      const moved = await this.transitionImproveStatus(
        reportId,
        RoleplayReportImproveStatus.IMPROVING,
        RoleplayReportImproveStatus.FAILED,
        { ...(report.improveMeta ?? {}), error: 'Auto-improve timed out' },
      );
      if (moved) {
        this.logger.info(
          `Marked auto-improve of report ${reportId} as FAILED due to TTL expiration`,
        );
      }
      return;
    }
    if (report.improveStatus === RoleplayReportImproveStatus.RERUNNING) {
      // A live re-run exists → the normal finalizeEndedRun path will close
      // RERUNNING out; only the run-less orphan is failed here.
      const pendingRerun = await this.testRunRepository.findOne({
        where: {
          sourceReportId: reportId,
          status: In(TEST_RUN_PENDING_STATUSES),
        },
      });
      if (pendingRerun) {
        return;
      }
      const moved = await this.transitionImproveStatus(
        reportId,
        RoleplayReportImproveStatus.RERUNNING,
        RoleplayReportImproveStatus.FAILED,
        {
          ...(report.improveMeta ?? {}),
          error: 'Timed out before the re-run started',
        },
      );
      if (moved) {
        this.logger.info(
          `Marked auto-improve of report ${reportId} as FAILED — ` +
            `RERUNNING with no re-run in flight after TTL expiration`,
        );
      }
    }
  }

  // ----------------------------------------------------------- auto-improve

  /**
   * Claim a report for an auto-improve copilot turn. Validates the report is
   * COMPLETED, belongs to the session's spec, isn't already being improved,
   * and that no run is in flight; then stamps IMPROVING atomically (a lost
   * race throws, so a double-click can't start two turns) and arms the
   * improve watchdog key.
   */
  async beginAutoImprove(
    reportId: string,
    sessionId: string,
    userId: number,
  ): Promise<RoleplayTestReport> {
    const report = await this.getReportRow(reportId);
    const spec = await this.roleplaySpecService.getSpec(report.specId);
    await this.assertSpecOwnership(spec, userId);

    const session = await this.copilotSessionService.getSession(
      sessionId,
      userId,
    );
    if (session.specId !== report.specId) {
      throw new BadRequestException(
        'Copilot session belongs to a different spec than the report',
      );
    }
    if (report.status !== RoleplayTestReportStatus.COMPLETED) {
      throw new BadRequestException(
        'Auto-improve requires a completed test report',
      );
    }
    if (
      report.improveStatus === RoleplayReportImproveStatus.IMPROVING ||
      report.improveStatus === RoleplayReportImproveStatus.RERUNNING
    ) {
      throw new BadRequestException(
        'An auto-improve is already running for this report',
      );
    }
    const pending = await this.testRunRepository.findPendingForSpec(
      report.specId,
    );
    if (pending.length > 0) {
      throw new BadRequestException(
        'A test run is already in progress for this spec',
      );
    }

    // Atomic claim — the guard re-checks under the UPDATE (improveStatus
    // unset OR terminal) so two concurrent begins can't both win.
    const activeStatuses = [
      RoleplayReportImproveStatus.IMPROVING,
      RoleplayReportImproveStatus.RERUNNING,
    ];
    const claim = await this.testReportRepository.update(
      [
        {
          id: reportId,
          status: RoleplayTestReportStatus.COMPLETED,
          improveStatus: IsNull(),
        },
        {
          id: reportId,
          status: RoleplayTestReportStatus.COMPLETED,
          improveStatus: Not(In(activeStatuses)),
        },
      ],
      {
        improveStatus: RoleplayReportImproveStatus.IMPROVING,
        improveMeta: { copilotSessionId: sessionId } as Record<string, any>,
        updatedBy: userId,
      },
    );
    if (!claim.affected) {
      throw new BadRequestException(
        'An auto-improve is already running for this report',
      );
    }

    await this.redisService.set(
      `${IMPROVE_REDIS_KEY_PREFIX}:${reportId}`,
      reportId,
      this.configService.roleplayStudio.improveTurnTimeoutMinutes * 60,
    );
    return this.getReportRow(reportId);
  }

  /**
   * Close out an auto-improve turn (called from the stream controller's
   * finally, even when the client is long gone):
   *  - the copilot applied ≥1 update_spec patch (`doneData.specVersionId`) →
   *    IMPROVING→RERUNNING and re-run the SAME case pinned to that exact
   *    version (dodges post-turn draft races);
   *  - done without patches → NO_CHANGES (the explanation is in the chat);
   *  - no done frame / re-run creation failure → FAILED with the error.
   * Transitions are guarded on the current improveStatus, so a watchdog that
   * already failed the report (or a duplicate call) is a no-op.
   */
  async finishAutoImproveTurn(
    reportId: string,
    userId: number,
    doneData: Record<string, any> | null,
  ): Promise<void> {
    try {
      const report = await this.testReportRepository.findOne({
        where: { id: reportId },
      });
      if (
        !report ||
        report.improveStatus !== RoleplayReportImproveStatus.IMPROVING
      ) {
        return;
      }
      const meta = report.improveMeta ?? {};

      if (!doneData) {
        await this.transitionImproveStatus(
          reportId,
          RoleplayReportImproveStatus.IMPROVING,
          RoleplayReportImproveStatus.FAILED,
          { ...meta, error: 'Copilot turn ended without completing' },
        );
        return;
      }
      if (!doneData.specVersionId) {
        // The copilot answered/asked without patching — nothing to re-run.
        await this.transitionImproveStatus(
          reportId,
          RoleplayReportImproveStatus.IMPROVING,
          RoleplayReportImproveStatus.NO_CHANGES,
          meta,
        );
        return;
      }

      const nextMeta = {
        ...meta,
        assistantMessageSeq: doneData.messageSeq ?? null,
        newSpecVersionId: doneData.specVersionId,
      };
      const claimed = await this.transitionImproveStatus(
        reportId,
        RoleplayReportImproveStatus.IMPROVING,
        RoleplayReportImproveStatus.RERUNNING,
        nextMeta,
      );
      if (!claimed) {
        return;
      }
      try {
        const parentRun = await this.getRun(report.runId);
        await this.createTestRun(
          report.specId,
          {
            agentTestCaseIds: [report.agentTestCaseId],
            turnsPerCase: parentRun.config?.turnsPerCase,
            languageId: parentRun.config?.languageId ?? undefined,
            judgeModel: parentRun.config?.judgeModel ?? undefined,
            traineeModel: parentRun.config?.traineeModel ?? undefined,
          },
          userId,
          {
            sourceReportId: reportId,
            // Replay the parent's stored snapshot — the source test case may
            // have been edited or hard-deleted since the first run.
            testCaseSnapshotsOverride: [report.testCaseSnapshot],
            specVersionId: String(doneData.specVersionId),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Auto-improve re-run failed for report ${reportId}: ${message}`,
        );
        await this.transitionImproveStatus(
          reportId,
          RoleplayReportImproveStatus.RERUNNING,
          RoleplayReportImproveStatus.FAILED,
          { ...nextMeta, error: message },
        );
      }
    } finally {
      await this.redisService.del(`${IMPROVE_REDIS_KEY_PREFIX}:${reportId}`);
    }
  }

  /** Guarded one-way improveStatus transition; true when the row moved. */
  private async transitionImproveStatus(
    reportId: string,
    from: RoleplayReportImproveStatus,
    to: RoleplayReportImproveStatus,
    improveMeta?: Record<string, any>,
  ): Promise<boolean> {
    const result = await this.testReportRepository.update(
      { id: reportId, improveStatus: from },
      { improveStatus: to, ...(improveMeta ? { improveMeta } : {}) },
    );
    return (result.affected ?? 0) > 0;
  }

  // ------------------------------------------------------------------- misc

  /**
   * Same scoping rule as RoleplaySpecService/listSpecs: multi-tenant admins
   * only touch their own specs (and therefore their runs/reports).
   */
  private async assertSpecOwnership(
    spec: RoleplaySpec,
    userId: number,
  ): Promise<void> {
    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    if (isMultiTenantAdmin && spec.createdBy !== userId) {
      throw new ForbiddenException(
        'You can only access test runs for your own roleplay specs',
      );
    }
  }
}
