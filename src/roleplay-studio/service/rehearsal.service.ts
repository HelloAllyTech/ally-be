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
import { CritiqueProposal } from '../entity/critique-proposal.entity';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import { CritiqueProposalStatus } from '../enum/critique-proposal-status.enum';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from '../repository/rehearsal-transcript.repository';
import { CritiqueProposalRepository } from '../repository/critique-proposal.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecCompilerService } from './spec-compiler.service';
import { SpecValidatorService } from './spec-validator.service';
import { RehearsalNotificationService } from './rehearsal-notification.service';
import { CritiqueEvidenceService } from './critique-evidence.service';
import { ImprovementHookService } from './improvement-hook.service';
import { applyJsonPatch, JsonPatchOp } from '../util/json-patch.util';
import {
  CreateRehearsalDto,
  UpdateCritiqueProposalStatusDto,
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
    private readonly critiqueProposalRepository: CritiqueProposalRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly specCompiler: SpecCompilerService,
    private readonly specValidator: SpecValidatorService,
    private readonly rehearsalNotificationService: RehearsalNotificationService,
    private readonly critiqueEvidenceService: CritiqueEvidenceService,
    private readonly improvementHookService: ImprovementHookService,
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
    options: { improvementRoundId?: string } = {},
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
        improvementRoundId: options.improvementRoundId ?? null,
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
      await this.notifyImprovementLoop(run.id);
    }
  }

  /** Hand a just-ended run to the auto-improve loop (no-op for standalone runs). */
  private async notifyImprovementLoop(rehearsalId: string): Promise<void> {
    try {
      const run = await this.rehearsalRunRepository.findOne({
        where: { id: rehearsalId },
      });
      if (run?.improvementRoundId) {
        this.improvementHookService.notifyRehearsalFinished(run);
      }
    } catch (error) {
      this.logger.error(
        `Failed to notify improvement loop for rehearsal ${rehearsalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
    await this.notifyImprovementLoop(rehearsalId);
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
    // Only a REAL transition into an end status advances the loop — a locked
    // (already-ended) run's late webhook must not re-fire the hook.
    if (
      !statusLocked &&
      updatePayload.status !== undefined &&
      REHEARSAL_END_STATUSES.includes(updatePayload.status)
    ) {
      await this.notifyImprovementLoop(rehearsalId);
    }
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
   * Post-rehearsal critique. Renders the rehearsal_critique prompt with the
   * spec + judge results + report + condensed transcript evidence + the
   * spec's prior-proposal history, then normalizes and pre-validates every
   * proposal and persists the batch as roleplay_critique_proposals rows.
   *
   * Proposals whose ops fail to apply or produce a structurally invalid spec
   * are persisted as SKIPPED_INVALID and not returned — callers only ever see
   * patches that are guaranteed to apply cleanly to this version's document.
   */
  async critiqueRehearsal(
    rehearsalId: string,
    userId: number,
    options: { improvementRunId?: string; roundNumber?: number } = {},
  ): Promise<{ proposals: CritiqueProposal[] }> {
    const run = await this.getRehearsal(rehearsalId);
    if (run.status !== RehearsalStatus.COMPLETED) {
      throw new BadRequestException('Critique requires a completed rehearsal');
    }
    const version = await this.roleplaySpecService.getVersionById(
      run.specVersionId,
    );
    const transcripts =
      await this.rehearsalTranscriptRepository.listByRun(rehearsalId);
    const evidence = this.critiqueEvidenceService.buildEvidence(
      run,
      transcripts,
      version.spec,
    );
    const history = await this.critiqueProposalRepository.historyForSpec(
      run.specId,
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
        evidence,
        proposalHistory: this.renderProposalHistory(history),
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
    const rawProposals = Array.isArray(parsed.proposals)
      ? parsed.proposals
      : [];

    // Re-critique replaces prior UNDECIDED proposals for this run; decided
    // ones (applied/rejected/verified/…) are the audit trail and stay.
    await this.critiqueProposalRepository.softDelete({
      rehearsalRunId: rehearsalId,
      status: CritiqueProposalStatus.PROPOSED,
    });

    const saved: CritiqueProposal[] = [];
    for (const rawProposal of rawProposals) {
      const normalized = this.normalizeProposal(rawProposal);
      if (!normalized) continue;
      const status = this.validateProposalOps(version.spec, normalized.ops)
        ? CritiqueProposalStatus.PROPOSED
        : CritiqueProposalStatus.SKIPPED_INVALID;
      const row = await this.critiqueProposalRepository.save(
        this.critiqueProposalRepository.create({
          rehearsalRunId: rehearsalId,
          specVersionId: version.id,
          improvementRunId: options.improvementRunId ?? null,
          roundNumber: options.roundNumber ?? null,
          ...normalized,
          status,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
      if (status === CritiqueProposalStatus.PROPOSED) {
        saved.push(row);
      }
    }
    return { proposals: saved };
  }

  /**
   * Accept whatever proposal shape the LLM produced — canonical flat `ops`,
   * legacy `patch: {ops, summary}`, or legacy `patch: [...]` — and return the
   * canonical row fields. Unknown severity coerces to "minor".
   */
  private normalizeProposal(raw: Record<string, any>): {
    ops: JsonPatchOp[];
    summary: string;
    rationale: string;
    targetSection: string;
    severity: string;
    expectedEffect: Record<string, any> | null;
  } | null {
    const ops: unknown = Array.isArray(raw.ops)
      ? raw.ops
      : Array.isArray(raw.patch?.ops)
        ? raw.patch.ops
        : Array.isArray(raw.patch)
          ? raw.patch
          : null;
    if (!Array.isArray(ops) || ops.length === 0) return null;

    const severityRaw = String(raw.severity ?? '').toLowerCase();
    const severity = ['critical', 'major', 'minor'].includes(severityRaw)
      ? severityRaw
      : 'minor';
    const summary = String(
      raw.summary ?? raw.patch?.summary ?? 'Spec edit',
    ).slice(0, 250);

    const expectedEffect =
      raw.expectedEffect && typeof raw.expectedEffect === 'object'
        ? {
            dimensions: Array.isArray(raw.expectedEffect.dimensions)
              ? raw.expectedEffect.dimensions
              : [],
            testCases: Array.isArray(raw.expectedEffect.testCases)
              ? raw.expectedEffect.testCases
              : [],
          }
        : null;

    return {
      ops: ops as JsonPatchOp[],
      summary,
      rationale: String(raw.rationale ?? ''),
      targetSection: String(raw.targetSection ?? 'spec'),
      severity,
      expectedEffect,
    };
  }

  /** True when the ops apply cleanly AND the result passes structural validation. */
  private validateProposalOps(
    specDocument: Record<string, any>,
    ops: JsonPatchOp[],
  ): boolean {
    try {
      const next = applyJsonPatch(specDocument, ops);
      const blocking = this.specValidator
        .validateStructure(next)
        .filter((issue) => issue.code !== 'required');
      return blocking.length === 0;
    } catch {
      return false;
    }
  }

  /** One line per prior proposal — the prompt's oscillation guard. */
  private renderProposalHistory(history: CritiqueProposal[]): string {
    if (history.length === 0) return '(none)';
    return history
      .slice(-40) // most recent 40 keep the prompt bounded
      .map(
        (proposal) =>
          `- [${proposal.status}] (${proposal.severity}, ${proposal.targetSection}) ${proposal.summary}`,
      )
      .join('\n');
  }

  // ---------------------------------------------------- proposal lifecycle

  async listProposals(rehearsalId: string): Promise<CritiqueProposal[]> {
    await this.getRehearsal(rehearsalId);
    return this.critiqueProposalRepository.listByRehearsal(rehearsalId);
  }

  /**
   * Record the trainer's interactive accept/reject (the web applies accepted
   * ops locally via the spec slice; this endpoint keeps the audit trail and
   * the critique history accurate).
   */
  async updateProposalStatus(
    proposalId: string,
    dto: UpdateCritiqueProposalStatusDto,
    userId: number,
  ): Promise<CritiqueProposal> {
    const proposal = await this.critiqueProposalRepository.findOne({
      where: { id: proposalId },
    });
    if (!proposal) {
      throw new NotFoundException('Critique proposal not found');
    }
    if (proposal.status !== CritiqueProposalStatus.PROPOSED) {
      throw new BadRequestException(
        `Proposal is already ${proposal.status.toLowerCase()}`,
      );
    }
    const status =
      dto.status === 'applied'
        ? CritiqueProposalStatus.APPLIED
        : CritiqueProposalStatus.REJECTED;
    await this.critiqueProposalRepository.update(proposalId, {
      status,
      appliedInVersionId:
        status === CritiqueProposalStatus.APPLIED
          ? (dto.appliedInVersionId ?? null)
          : null,
      updatedBy: userId,
    });
    return (await this.critiqueProposalRepository.findOne({
      where: { id: proposalId },
    }))!;
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
      await this.notifyImprovementLoop(rehearsalId);
    }
  }
}
