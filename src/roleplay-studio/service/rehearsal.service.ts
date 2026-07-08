import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { AgentTestCase } from 'src/learn/entity/agent-test-case.entity';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { TIME } from 'src/common/constants/time.constants';
import { AnthropicAutofillService } from 'src/learn/service/anthropic-autofill.service';
import { RehearsalRun } from '../entity/rehearsal-run.entity';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from '../repository/rehearsal-transcript.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecCompilerService } from './spec-compiler.service';
import { SpecValidatorService } from './spec-validator.service';
import { RehearsalNotificationService } from './rehearsal-notification.service';
import {
  CreateRehearsalDto,
  UpdateRehearsalWebhookDto,
} from '../dto/rehearsal.dto';
import {
  REHEARSAL_CONDITION_DRIVEN_LABEL,
  REHEARSAL_DEFAULT_TURNS_PER_PROFILE,
  REHEARSAL_END_STATUSES,
  REHEARSAL_MAX_UNITS,
  REHEARSAL_PENDING_STATUSES,
  REHEARSAL_REDIS_KEY_PREFIX,
  REHEARSAL_TRAINEE_PROFILES,
  ROLEPLAY_COPILOT_PROMPTS,
} from '../constants/roleplay-studio.constants';
import { SPEC_SCHEMA_VERSION } from '../type/roleplay-spec-document.type';
import { RoleplayRehearsalTestCase } from '../type/rehearsal-run-request.type';

/**
 * Rehearsal lifecycle — a scenario-report clone for Roleplay Studio v2:
 * one non-terminal run per spec version, redis TTL watchdog, ai-learn
 * trigger/cancel, webhook updates with one-way end statuses, socket.io
 * progress notifications, and the post-run critique (spec-patch proposals).
 */
@Injectable()
export class RehearsalService {
  private readonly logger = LoggerService.getInstance(RehearsalService.name);

  constructor(
    private readonly rehearsalRunRepository: RehearsalRunRepository,
    private readonly rehearsalTranscriptRepository: RehearsalTranscriptRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly specCompiler: SpecCompilerService,
    private readonly specValidator: SpecValidatorService,
    private readonly rehearsalNotificationService: RehearsalNotificationService,
    private readonly aiService: AiService,
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
    // AgentTestCase lives in LearnModule (not imported here); reach its
    // repository through the app DataSource — same pattern as
    // SpecValidatorService.
    private readonly dataSource: DataSource,
    // AnthropicAutofillService lives in LearnModule and is not exported; the
    // learn module must stay untouched, so it is resolved lazily from the
    // app-wide container (strict: false) for the critique flow only.
    private readonly moduleRef: ModuleRef,
  ) {}

  private get timeoutMinutes(): number {
    return this.configService.roleplayStudio.rehearsalTimeoutMinutes;
  }

  // ------------------------------------------------------------------ start

  async createRehearsal(
    specId: string,
    specVersionId: string,
    dto: CreateRehearsalDto,
    userId: number,
  ): Promise<RehearsalRun> {
    const spec = await this.roleplaySpecService.getSpec(specId);
    const version = await this.roleplaySpecService.getVersion(
      specId,
      specVersionId,
    );

    // A rehearsal of an invalid spec would only measure noise.
    const validation = await this.specValidator.validate(version.spec);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'Spec version failed validation; fix it before rehearsing',
        errors: validation.errors,
      });
    }

    // One live rehearsal per version at a time.
    const pending =
      await this.rehearsalRunRepository.findPendingForVersion(specVersionId);
    if (pending.length > 0) {
      throw new BadRequestException(
        'A rehearsal is already in progress for this spec version',
      );
    }

    // undefined → all three (back-compat); explicit [] → test-case-only run.
    const traineeProfiles = dto.traineeProfiles ?? REHEARSAL_TRAINEE_PROFILES;
    const testCases = await this.loadTestCaseSnapshots(
      dto.agentTestCaseIds ?? [],
    );
    const totalUnits = traineeProfiles.length + testCases.length;
    if (totalUnits === 0) {
      throw new BadRequestException(
        'Select at least one trainee profile or agent test case',
      );
    }
    if (totalUnits > REHEARSAL_MAX_UNITS) {
      throw new BadRequestException(
        `A rehearsal can run at most ${REHEARSAL_MAX_UNITS} sessions ` +
          `(profiles + test cases); got ${totalUnits}`,
      );
    }

    const config = {
      traineeProfiles,
      turnsPerProfile:
        dto.turnsPerProfile ?? REHEARSAL_DEFAULT_TURNS_PER_PROFILE,
      languageId:
        dto.languageId ??
        (version.spec as Record<string, any>)?.language?.languageId,
      judgeModel: dto.judgeModel ?? null,
      // Snapshots (camelCase key in storage, snake_case on the wire): the
      // agent_test_cases table is global + hard-deleted, so historical runs
      // must stay self-describing.
      testCases,
      // Units run serially in ai-learn — scale the watchdog with the load
      // (3 units ≙ the historical baseline the default timeout was sized for).
      timeoutMinutes: this.timeoutMinutes * Math.ceil(totalUnits / 3),
    };
    const run = await this.rehearsalRunRepository.save(
      this.rehearsalRunRepository.create({
        specId: spec.id,
        specVersionId: version.id,
        status: RehearsalStatus.STARTED,
        config,
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    this.rehearsalNotificationService.notifyUpdate(userId, run.id);

    // TTL watchdog (scenario-report pattern): key expiry fails stuck runs.
    await this.redisService.set(
      `${REHEARSAL_REDIS_KEY_PREFIX}:${run.id}`,
      run.id,
      config.timeoutMinutes * 60,
    );

    await this.triggerRehearsalRun(run, version.spec as Record<string, any>);
    return this.getRehearsal(run.id);
  }

  /**
   * Fetch + validate the selected agent test cases and snapshot
   * {id,title,category,condition,test} preserving the request order.
   * Invalid selections 400 with EVERY offending id (unknown ids and ids
   * whose condition/test is blank) — never silently skipped.
   */
  private async loadTestCaseSnapshots(
    ids: string[],
  ): Promise<RoleplayRehearsalTestCase[]> {
    if (ids.length === 0) {
      return [];
    }
    const found = await this.dataSource
      .getRepository(AgentTestCase)
      .find({ where: { id: In(ids) } });
    const byId = new Map(found.map((testCase) => [testCase.id, testCase]));

    const missing = ids.filter((id) => !byId.has(id));
    const blank = ids.filter((id) => {
      const testCase = byId.get(id);
      return (
        testCase !== undefined &&
        (!testCase.condition?.trim() || !testCase.test?.trim())
      );
    });
    const problems: string[] = [];
    if (missing.length > 0) {
      problems.push(`unknown agent test case ids: ${missing.join(', ')}`);
    }
    if (blank.length > 0) {
      problems.push(
        `agent test cases missing a condition or test: ${blank.join(', ')}`,
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
        category: testCase.category ?? null,
        condition: testCase.condition!,
        test: testCase.test!,
      };
    });
  }

  private async triggerRehearsalRun(
    run: RehearsalRun,
    specDocument: Record<string, any>,
  ): Promise<void> {
    try {
      await this.aiService.triggerRoleplayRehearsalRun({
        rehearsal_id: run.id,
        spec: this.specCompiler.compile(specDocument),
        spec_schema_version:
          specDocument.specSchemaVersion ?? SPEC_SCHEMA_VERSION,
        config: {
          trainee_profiles: run.config.traineeProfiles,
          turns_per_profile: run.config.turnsPerProfile,
          language_id: run.config.languageId,
          judge_model: run.config.judgeModel,
          test_cases: run.config.testCases ?? [],
        },
      });

      // Late-webhook guard: never flip a run that already ended.
      const current = await this.rehearsalRunRepository.findOne({
        where: { id: run.id },
      });
      if (current && !REHEARSAL_END_STATUSES.includes(current.status)) {
        await this.rehearsalRunRepository.update(run.id, {
          status: RehearsalStatus.IN_PROGRESS,
          updatedBy: run.updatedBy,
        });
      }
      this.rehearsalNotificationService.notifyUpdate(run.createdBy, run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Rehearsal trigger failed for run ${run.id}: ${message}`,
      );
      await this.rehearsalRunRepository.update(run.id, {
        status: RehearsalStatus.FAILED,
        metadata: { errorMessage: message } as Record<string, any>,
        endedAt: new Date(),
        updatedBy: run.updatedBy,
      });
      await this.redisService.del(`${REHEARSAL_REDIS_KEY_PREFIX}:${run.id}`);
      this.rehearsalNotificationService.notifyUpdate(run.createdBy, run.id);
    }
  }

  // ------------------------------------------------------------------ reads

  async getRehearsal(rehearsalId: string): Promise<RehearsalRun> {
    const run = await this.rehearsalRunRepository.findOne({
      where: { id: rehearsalId },
    });
    if (!run) {
      throw new NotFoundException('Rehearsal not found');
    }
    return run;
  }

  async listRehearsals(
    specId: string,
    specVersionId?: string,
  ): Promise<RehearsalRun[]> {
    await this.roleplaySpecService.getSpec(specId);
    return this.rehearsalRunRepository.listBySpec(specId, specVersionId);
  }

  async getTranscripts(rehearsalId: string) {
    await this.getRehearsal(rehearsalId);
    return this.rehearsalTranscriptRepository.listByRun(rehearsalId);
  }

  async getRecentRehearsalsForUser(
    createdBy: number,
    lookbackMinutes?: number,
  ): Promise<RehearsalRun[]> {
    return this.rehearsalRunRepository.findRecentByCreatedBy(
      createdBy,
      lookbackMinutes,
    );
  }

  // ----------------------------------------------------------------- cancel

  async cancelRehearsal(
    rehearsalId: string,
    userId: number,
  ): Promise<SuccessResponse> {
    const run = await this.getRehearsal(rehearsalId);
    if (run.createdBy !== userId) {
      throw new ForbiddenException(
        'You are not allowed to cancel this rehearsal',
      );
    }
    if (REHEARSAL_END_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        'Cannot cancel a rehearsal that is already completed, cancelled, or failed',
      );
    }

    await this.rehearsalRunRepository.update(rehearsalId, {
      status: RehearsalStatus.CANCELLED,
      endedAt: new Date(),
      updatedBy: userId,
    });
    await this.redisService.del(`${REHEARSAL_REDIS_KEY_PREFIX}:${rehearsalId}`);

    // Best-effort propagation so ai-learn stops burning tokens.
    await this.aiService.triggerRoleplayRehearsalCancel(rehearsalId);

    this.rehearsalNotificationService.notifyUpdate(run.createdBy, rehearsalId);
    return { success: true };
  }

  // ---------------------------------------------------------------- webhook

  /**
   * ai-learn progress/result webhook. End statuses are one-way (a late
   * webhook can't flip COMPLETED/FAILED/CANCELLED back), but additive data —
   * transcripts, results, report — is always accepted, mirroring the
   * scenario-report guard.
   */
  async updateRehearsalFromWebhook(
    rehearsalId: string,
    dto: UpdateRehearsalWebhookDto,
  ): Promise<RehearsalRun> {
    this.logger.info(
      `Rehearsal webhook for ${rehearsalId} with status: ${dto.status}`,
    );
    const run = await this.getRehearsal(rehearsalId);
    const statusLocked = REHEARSAL_END_STATUSES.includes(run.status);

    const updatePayload: Partial<RehearsalRun> = {};
    if (dto.progress !== undefined) updatePayload.progress = dto.progress;
    if (dto.results !== undefined) updatePayload.results = dto.results;
    if (dto.report_markdown !== undefined) {
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
      if (REHEARSAL_END_STATUSES.includes(dto.status)) {
        updatePayload.endedAt = new Date();
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.rehearsalRunRepository.update(rehearsalId, updatePayload);
      if (
        updatePayload.status !== undefined &&
        REHEARSAL_END_STATUSES.includes(updatePayload.status)
      ) {
        await this.redisService.del(
          `${REHEARSAL_REDIS_KEY_PREFIX}:${rehearsalId}`,
        );
      }
    }

    if (dto.transcripts && dto.transcripts.length > 0) {
      await this.upsertTranscripts(rehearsalId, dto.transcripts);
    }

    this.rehearsalNotificationService.notifyUpdate(run.createdBy, rehearsalId);
    return this.getRehearsal(rehearsalId);
  }

  /**
   * One row per trainee profile plus one per agent test case: replace on
   * re-delivery, insert otherwise. Test-case entries (test_case_id set) are
   * keyed by { rehearsalRunId, agentTestCaseId } and labelled
   * CONDITION_DRIVEN; profile entries keep the legacy key.
   */
  private async upsertTranscripts(
    rehearsalId: string,
    transcripts: Record<string, any>[],
  ): Promise<void> {
    for (const entry of transcripts) {
      const fields = {
        transcript: Array.isArray(entry.transcript) ? entry.transcript : [],
        judgeScores: entry.judge_scores ?? null,
        judgeNotes: entry.judge_notes ?? null,
        directorTrace: entry.director_trace ?? null,
      };

      if (entry.test_case_id) {
        const agentTestCaseId = String(entry.test_case_id);
        const caseFields = {
          ...fields,
          testCaseResult: entry.test_result ?? null,
        };
        const existing = await this.rehearsalTranscriptRepository.findOne({
          where: { rehearsalRunId: rehearsalId, agentTestCaseId },
        });
        if (existing) {
          await this.rehearsalTranscriptRepository.update(
            existing.id,
            caseFields,
          );
        } else {
          await this.rehearsalTranscriptRepository.save(
            this.rehearsalTranscriptRepository.create({
              rehearsalRunId: rehearsalId,
              agentTestCaseId,
              traineeProfile: REHEARSAL_CONDITION_DRIVEN_LABEL,
              ...caseFields,
            }),
          );
        }
        continue;
      }

      const traineeProfile = String(entry.trainee_profile ?? 'UNKNOWN');
      const existing = await this.rehearsalTranscriptRepository.findOne({
        where: { rehearsalRunId: rehearsalId, traineeProfile },
      });
      if (existing) {
        await this.rehearsalTranscriptRepository.update(existing.id, fields);
      } else {
        await this.rehearsalTranscriptRepository.save(
          this.rehearsalTranscriptRepository.create({
            rehearsalRunId: rehearsalId,
            traineeProfile,
            ...fields,
          }),
        );
      }
    }
  }

  // --------------------------------------------------------------- critique

  /**
   * Post-rehearsal critique: renders the rehearsal_critique prompt with the
   * spec + judge results + report and returns
   * { proposals: [{ patch, rationale, targetSection, severity }] }.
   */
  async critiqueRehearsal(
    rehearsalId: string,
  ): Promise<{ proposals: Record<string, any>[] }> {
    const run = await this.getRehearsal(rehearsalId);
    if (run.status !== RehearsalStatus.COMPLETED) {
      throw new BadRequestException('Critique requires a completed rehearsal');
    }
    const version = await this.roleplaySpecService.getVersionById(
      run.specVersionId,
    );

    const anthropicAutofillService = this.moduleRef.get(
      AnthropicAutofillService,
      { strict: false },
    );
    const raw = await anthropicAutofillService.generateContentFromPrompt(
      ROLEPLAY_COPILOT_PROMPTS.REHEARSAL_CRITIQUE,
      {
        spec: JSON.stringify(version.spec, null, 2),
        results: JSON.stringify(run.results ?? {}, null, 2),
        reportMarkdown: run.reportMarkdown ?? '(no report)',
      },
      true, // expectJson
    );

    let parsed: { proposals?: Record<string, any>[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error(
        `Rehearsal critique returned unparseable JSON for ${rehearsalId}`,
      );
      throw new UnprocessableEntityException(
        'Critique model returned invalid JSON; try again',
      );
    }
    return {
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    };
  }

  // ---------------------------------------------------------------- timeouts

  /** Redis-TTL expiry hook: fail the run if it outlived the timeout. */
  async handleExpiredRehearsal(rehearsalId: string): Promise<void> {
    const run = await this.rehearsalRunRepository.findOne({
      where: { id: rehearsalId },
    });
    if (!run || REHEARSAL_END_STATUSES.includes(run.status)) {
      return;
    }
    // Per-run timeout scales with the unit count; class default covers rows
    // created before config.timeoutMinutes existed.
    const timeoutMinutes = run.config?.timeoutMinutes ?? this.timeoutMinutes;
    const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
    if (run.createdAt > cutoff) {
      return;
    }
    const result = await this.rehearsalRunRepository.update(
      { id: rehearsalId, status: In(REHEARSAL_PENDING_STATUSES) },
      {
        status: RehearsalStatus.FAILED,
        metadata: { errorMessage: 'Failed due to timeout' } as Record<
          string,
          any
        >,
        endedAt: new Date(),
      },
    );
    if (result.affected && result.affected > 0) {
      this.logger.info(
        `Marked rehearsal ${rehearsalId} as FAILED due to TTL expiration`,
      );
      this.rehearsalNotificationService.notifyUpdate(
        run.createdBy,
        rehearsalId,
      );
    }
  }
}
