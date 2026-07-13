import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { TIME } from 'src/common/constants/time.constants';
import { ImprovementRun } from '../entity/improvement-run.entity';
import { ImprovementRound } from '../entity/improvement-round.entity';
import { RehearsalRun } from '../entity/rehearsal-run.entity';
import { CritiqueProposal } from '../entity/critique-proposal.entity';
import {
  ImprovementRoundKind,
  ImprovementRoundStatus,
  ImprovementRunOutcome,
  ImprovementRunStatus,
} from '../enum/improvement-run.enum';
import {
  RehearsalStatus,
  RehearsalTraineeProfile,
} from '../enum/rehearsal-status.enum';
import { CritiqueProposalStatus } from '../enum/critique-proposal-status.enum';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { ImprovementRunRepository } from '../repository/improvement-run.repository';
import { ImprovementRoundRepository } from '../repository/improvement-round.repository';
import { CritiqueProposalRepository } from '../repository/critique-proposal.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecValidatorService } from './spec-validator.service';
import { RehearsalService } from './rehearsal.service';
import {
  RehearsalComparison,
  RehearsalComparisonService,
} from './rehearsal-comparison.service';
import { ImprovementHookService } from './improvement-hook.service';
import { ImprovementNotificationService } from './improvement-notification.service';
import { ImprovementNarrationService } from './improvement-narration.service';
import { applyJsonPatch, JsonPatchOp } from '../util/json-patch.util';
import { diffSpecDocuments } from '../util/spec-diff.util';
import {
  ResolveImprovementRunDto,
  StartImprovementRunDto,
} from '../dto/improvement.dto';
import {
  IMPROVEMENT_DEFAULT_MAX_ROUNDS,
  IMPROVEMENT_DEFAULT_TARGETS,
  IMPROVEMENT_REDIS_KEY_PREFIX,
  IMPROVEMENT_VERIFICATION_TOLERANCE,
  REHEARSAL_TRAINEE_PROFILES,
} from '../constants/roleplay-studio.constants';

const DIMENSION_SCREEN_TARGET = 70;

/**
 * The auto-improve loop: rehearse → critique (evidence-rich) → apply the
 * proposals to a scratch version lineage → re-rehearse, until the configured
 * targets are met, the critic runs dry, or maxRounds is exhausted. The
 * trainer then reviews the best round's version + score trajectory and
 * accepts (its spec becomes the draft) or discards.
 *
 * Advancement is event-driven: RehearsalService fires ImprovementHookService
 * whenever a loop-linked rehearsal reaches an end status; a run-level Redis
 * TTL watchdog finishes a stalled run with its best-so-far result.
 *
 * Robust-to-noise gates: the deterministic signals (test-case verdicts, the
 * leak-capped disclosure score, deterministic SKILLED rubric coverage) are
 * primary; judged dimensions are secondary with a noise band (see
 * RehearsalComparisonService). Best round ranks tests-passed first.
 */
@Injectable()
export class ImprovementOrchestratorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ImprovementOrchestratorService.name,
  );

  constructor(
    private readonly improvementRunRepository: ImprovementRunRepository,
    private readonly improvementRoundRepository: ImprovementRoundRepository,
    private readonly critiqueProposalRepository: CritiqueProposalRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly specValidator: SpecValidatorService,
    private readonly rehearsalService: RehearsalService,
    private readonly comparisonService: RehearsalComparisonService,
    private readonly improvementHookService: ImprovementHookService,
    private readonly notificationService: ImprovementNotificationService,
    private readonly narrationService: ImprovementNarrationService,
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.improvementHookService.addListener((run) => {
      // Fire-and-forget: the hook is called from rehearsal paths that must
      // never fail because loop advancement failed.
      void this.onRehearsalFinished(run).catch((error) => {
        this.logger.error(
          `Improvement loop advancement failed for rehearsal ${run.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }

  onModuleDestroy(): void {
    this.improvementHookService.removeListener();
  }

  // ------------------------------------------------------------------- start

  async startImprovementRun(
    specId: string,
    versionId: string,
    dto: StartImprovementRunDto,
    userId: number,
    // Internal-caller options (the copilot's start_auto_improve tool) —
    // deliberately NOT on the REST DTO so API clients can't bind runs to
    // arbitrary chat sessions.
    options: {
      copilotSessionId?: string;
      autoAcceptOnTargetsMet?: boolean;
    } = {},
  ): Promise<ImprovementRun> {
    const spec = await this.roleplaySpecService.getSpec(specId);
    const version = await this.roleplaySpecService.getVersion(
      specId,
      versionId,
    );
    const validation = await this.specValidator.validate(version.spec);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'Spec version failed validation; fix it before auto-improve',
        errors: validation.errors,
      });
    }
    const active = await this.improvementRunRepository.findActiveForSpec(
      spec.id,
    );
    if (active) {
      throw new BadRequestException(
        'An improvement run is already in progress for this spec',
      );
    }

    const maxRounds = dto.maxRounds ?? IMPROVEMENT_DEFAULT_MAX_ROUNDS;
    const traineeProfiles = dto.traineeProfiles ?? [
      ...REHEARSAL_TRAINEE_PROFILES,
    ];
    const rehearsalTimeout =
      this.configService.roleplayStudio.rehearsalTimeoutMinutes;
    const totalUnits =
      traineeProfiles.length + (dto.agentTestCaseIds?.length ?? 0);
    // One scaled rehearsal window per possible round (+ final verification),
    // plus slack for the critique calls between rounds.
    const timeoutMinutes =
      rehearsalTimeout *
        Math.max(1, Math.ceil(totalUnits / 3)) *
        (maxRounds + 1) +
      10;

    const run = await this.improvementRunRepository.save(
      this.improvementRunRepository.create({
        specId: spec.id,
        baseVersionId: version.id,
        status: ImprovementRunStatus.RUNNING,
        config: {
          maxRounds,
          targets: { ...IMPROVEMENT_DEFAULT_TARGETS, ...(dto.targets ?? {}) },
          agentTestCaseIds: dto.agentTestCaseIds ?? [],
          traineeProfiles,
          turnsPerProfile: dto.turnsPerProfile,
          languageId: dto.languageId,
          judgeModel: dto.judgeModel,
          cheapIntermediateRounds: dto.cheapIntermediateRounds ?? true,
          timeoutMinutes,
          // Copilot linkage: progress is narrated into this chat session and
          // TARGETS_MET auto-applies the best version to the draft.
          copilotSessionId: options.copilotSessionId ?? null,
          autoAcceptOnTargetsMet: options.autoAcceptOnTargetsMet ?? false,
        },
        currentRound: 1,
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    await this.redisService.set(
      `${IMPROVEMENT_REDIS_KEY_PREFIX}:${run.id}`,
      run.id,
      timeoutMinutes * 60,
    );

    const round = await this.improvementRoundRepository.save(
      this.improvementRoundRepository.create({
        improvementRunId: run.id,
        roundNumber: 1,
        kind: ImprovementRoundKind.BASELINE,
        candidateVersionId: version.id,
        status: ImprovementRoundStatus.REHEARSING,
        fullScope: true,
      }),
    );

    this.notify(run);
    await this.dispatchRehearsal(run, round, null);
    return this.getRun(run.id);
  }

  // ------------------------------------------------------------------- reads

  async getRun(runId: string): Promise<ImprovementRun> {
    const run = await this.improvementRunRepository.findOne({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Improvement run not found');
    }
    return run;
  }

  async listRuns(specId: string): Promise<ImprovementRun[]> {
    await this.roleplaySpecService.getSpec(specId);
    return this.improvementRunRepository.listBySpec(specId);
  }

  /** Full detail: run + rounds + proposals grouped by round. */
  async getRunDetail(runId: string): Promise<Record<string, any>> {
    const run = await this.getRun(runId);
    const rounds = await this.improvementRoundRepository.listByRun(runId);
    const proposals =
      await this.critiqueProposalRepository.listByImprovementRun(runId);
    return { ...run, rounds, proposals };
  }

  /** Cumulative diff: base version vs the best (or latest candidate) version. */
  async getRunDiff(runId: string): Promise<Record<string, any>> {
    const run = await this.getRun(runId);
    const targetVersionId =
      run.bestVersionId ?? (await this.latestCandidateVersionId(runId));
    if (!targetVersionId || targetVersionId === run.baseVersionId) {
      return {
        baseVersionId: run.baseVersionId,
        bestVersionId: targetVersionId,
        changes: [],
      };
    }
    const baseVersion = await this.roleplaySpecService.getVersionById(
      run.baseVersionId,
    );
    const bestVersion =
      await this.roleplaySpecService.getVersionById(targetVersionId);
    return {
      baseVersionId: run.baseVersionId,
      bestVersionId: targetVersionId,
      changes: diffSpecDocuments(baseVersion.spec, bestVersion.spec),
    };
  }

  private async latestCandidateVersionId(
    runId: string,
  ): Promise<string | null> {
    const rounds = await this.improvementRoundRepository.listByRun(runId);
    return rounds.length > 0
      ? rounds[rounds.length - 1].candidateVersionId
      : null;
  }

  // -------------------------------------------------------------- loop steps

  /**
   * Called (via the hook) whenever a loop-linked rehearsal ends. Claims the
   * round atomically (REHEARSING → CRITIQUING) so webhook re-deliveries and
   * the timer path can never double-process a round.
   */
  async onRehearsalFinished(rehearsalRun: RehearsalRun): Promise<void> {
    if (!rehearsalRun.improvementRoundId) return;
    const round = await this.improvementRoundRepository.findOne({
      where: { id: rehearsalRun.improvementRoundId },
    });
    if (!round) return;
    const run = await this.improvementRunRepository.findOne({
      where: { id: round.improvementRunId },
    });
    if (!run || run.status !== ImprovementRunStatus.RUNNING) return;

    const claimed = await this.improvementRoundRepository.update(
      { id: round.id, status: ImprovementRoundStatus.REHEARSING },
      {
        status: ImprovementRoundStatus.CRITIQUING,
        rehearsalRunId: rehearsalRun.id,
      },
    );
    if (!claimed.affected) return; // already processed (idempotency guard)

    if (rehearsalRun.status !== RehearsalStatus.COMPLETED) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.FAILED,
      });
      const outcome =
        rehearsalRun.status === RehearsalStatus.CANCELLED
          ? ImprovementRunOutcome.REHEARSAL_FAILED
          : ImprovementRunOutcome.REHEARSAL_FAILED;
      await this.failRun(
        run,
        outcome,
        `Round ${round.roundNumber} rehearsal ended ${rehearsalRun.status}`,
      );
      return;
    }

    const scores = rehearsalRun.results ?? {};
    const { vsPrevious, vsBaseline } = await this.computeDeltas(
      run,
      round,
      scores,
    );
    await this.improvementRoundRepository.update(round.id, {
      scores,
      deltas: { vsPrevious, vsBaseline } as Record<string, any>,
    });
    round.scores = scores; // keep the in-memory row usable for narrowing

    await this.narrationService.postRoundScored(run, round, {
      vsPrevious,
      vsBaseline,
    });

    await this.verifyPreviousRoundProposals(run, round, vsPrevious);

    const targets = run.config.targets ?? {};
    const targetsMet = this.evaluateTargets(scores, targets, vsBaseline);

    if (targetsMet) {
      if (!round.fullScope) {
        // Cheap-scope evidence is a screen, not proof — verify at full scope.
        await this.improvementRoundRepository.update(round.id, {
          status: ImprovementRoundStatus.DONE,
        });
        await this.spawnRound(
          run,
          round.roundNumber + 1,
          ImprovementRoundKind.FINAL_VERIFICATION,
          round.candidateVersionId,
          round,
        );
        return;
      }
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.DONE,
      });
      await this.finishRun(run, ImprovementRunOutcome.TARGETS_MET);
      return;
    }

    if (round.roundNumber >= (run.config.maxRounds ?? 3)) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.DONE,
      });
      await this.finishRun(run, ImprovementRunOutcome.MAX_ROUNDS);
      return;
    }

    // FINAL_VERIFICATION that missed targets still consumed its shot — pick
    // the best and hand over to the trainer rather than looping again on the
    // same candidate.
    if (round.kind === ImprovementRoundKind.FINAL_VERIFICATION) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.DONE,
      });
      await this.finishRun(run, ImprovementRunOutcome.NO_IMPROVEMENT);
      return;
    }

    await this.runCritiqueAndApply(run, round);
  }

  private async runCritiqueAndApply(
    run: ImprovementRun,
    round: ImprovementRound,
  ): Promise<void> {
    this.notify(run);
    let proposals: CritiqueProposal[];
    try {
      const critique = await this.rehearsalService.critiqueRehearsal(
        round.rehearsalRunId!,
        run.createdBy,
        { improvementRunId: run.id, roundNumber: round.roundNumber },
      );
      proposals = critique.proposals;
    } catch (error) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.FAILED,
      });
      await this.failRun(
        run,
        ImprovementRunOutcome.REHEARSAL_FAILED,
        `Critique failed on round ${round.roundNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // Oscillation guard: hard-skip ops the loop has already tried, even if
    // the model ignored the prompt history.
    const seenOpsHashes = new Set(
      (await this.critiqueProposalRepository.listByImprovementRun(run.id))
        .filter((proposal) => proposal.roundNumber !== round.roundNumber)
        .map((proposal) => this.hashOps(proposal.ops as JsonPatchOp[])),
    );
    const fresh = proposals.filter(
      (proposal) =>
        !seenOpsHashes.has(this.hashOps(proposal.ops as JsonPatchOp[])),
    );

    if (fresh.length === 0) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.DONE,
      });
      await this.finishRun(run, ImprovementRunOutcome.NO_PROPOSALS);
      return;
    }

    await this.improvementRoundRepository.update(round.id, {
      status: ImprovementRoundStatus.APPLYING,
    });
    this.notify(run);

    // Fold proposals sequentially; each must keep the document valid on top
    // of the previous ones (a proposal validated in isolation can conflict
    // with an earlier sibling).
    const candidateVersion = await this.roleplaySpecService.getVersionById(
      round.candidateVersionId,
    );
    let workingDocument = candidateVersion.spec as Record<string, any>;
    const applied: CritiqueProposal[] = [];
    for (const proposal of fresh) {
      try {
        const next = applyJsonPatch(
          workingDocument,
          proposal.ops as JsonPatchOp[],
        );
        const blocking = this.specValidator
          .validateStructure(next)
          .filter((issue) => issue.code !== 'required');
        if (blocking.length > 0) throw new Error('validation failed');
        workingDocument = next;
        applied.push(proposal);
      } catch {
        await this.critiqueProposalRepository.update(proposal.id, {
          status: CritiqueProposalStatus.SKIPPED_INVALID,
        });
      }
    }

    if (applied.length === 0) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.DONE,
      });
      await this.finishRun(run, ImprovementRunOutcome.NO_PROPOSALS);
      return;
    }

    const newVersion = await this.roleplaySpecService.appendVersionSnapshot(
      run.specId,
      workingDocument,
      run.createdBy,
      RoleplaySpecVersionSource.AUTO_IMPROVE,
    );
    await this.critiqueProposalRepository.update(
      applied.map((proposal) => proposal.id),
      {
        status: CritiqueProposalStatus.APPLIED,
        appliedInVersionId: newVersion.id,
      },
    );
    await this.improvementRoundRepository.update(round.id, {
      status: ImprovementRoundStatus.DONE,
      proposalsAppliedCount: applied.length,
    });

    await this.narrationService.postProposalsApplied(run, round, applied);

    await this.spawnRound(
      run,
      round.roundNumber + 1,
      ImprovementRoundKind.ITERATION,
      newVersion.id,
      round,
    );
  }

  private async spawnRound(
    run: ImprovementRun,
    roundNumber: number,
    kind: ImprovementRoundKind,
    candidateVersionId: string,
    previousRound: ImprovementRound | null,
  ): Promise<void> {
    const cheap =
      kind === ImprovementRoundKind.ITERATION &&
      (run.config.cheapIntermediateRounds ?? true);
    // fullScope starts true; dispatchRehearsal flips it only when the scope
    // is genuinely narrowed (the cheap subset can fall back to full).
    const nextRound = await this.improvementRoundRepository.save(
      this.improvementRoundRepository.create({
        improvementRunId: run.id,
        roundNumber,
        kind,
        candidateVersionId,
        status: ImprovementRoundStatus.REHEARSING,
        fullScope: true,
      }),
    );
    await this.improvementRunRepository.update(run.id, {
      currentRound: roundNumber,
    });
    this.notify(run);
    await this.dispatchRehearsal(run, nextRound, cheap ? previousRound : null);
  }

  /**
   * Launch the round's rehearsal. `narrowFromRound` (cheap iteration rounds)
   * limits scope to the profiles/test cases that were failing in that round;
   * falls back to the full config when the subset would be empty.
   */
  private async dispatchRehearsal(
    run: ImprovementRun,
    round: ImprovementRound,
    narrowFromRound: ImprovementRound | null,
  ): Promise<void> {
    const config = run.config;
    let traineeProfiles: RehearsalTraineeProfile[] =
      config.traineeProfiles ?? [];
    let agentTestCaseIds: string[] = config.agentTestCaseIds ?? [];

    if (narrowFromRound?.scores) {
      const failingProfiles = this.failingProfiles(
        narrowFromRound.scores,
        config.targets ?? {},
      );
      const failingCases = this.failingTestCaseIds(narrowFromRound.scores);
      if (failingProfiles.length + failingCases.length > 0) {
        traineeProfiles = traineeProfiles.filter((profile) =>
          failingProfiles.includes(profile),
        );
        agentTestCaseIds = agentTestCaseIds.filter((id) =>
          failingCases.includes(id),
        );
        if (traineeProfiles.length + agentTestCaseIds.length === 0) {
          traineeProfiles = config.traineeProfiles ?? [];
          agentTestCaseIds = config.agentTestCaseIds ?? [];
        } else {
          await this.improvementRoundRepository.update(round.id, {
            fullScope: false,
          });
        }
      }
    }

    let rehearsal: RehearsalRun;
    try {
      rehearsal = await this.rehearsalService.createRehearsal(
        run.specId,
        round.candidateVersionId,
        {
          traineeProfiles,
          agentTestCaseIds,
          turnsPerProfile: config.turnsPerProfile,
          languageId: config.languageId,
          judgeModel: config.judgeModel,
        },
        run.createdBy,
        { improvementRoundId: round.id },
      );
    } catch (error) {
      await this.improvementRoundRepository.update(round.id, {
        status: ImprovementRoundStatus.FAILED,
      });
      await this.failRun(
        run,
        ImprovementRunOutcome.REHEARSAL_FAILED,
        `Could not start round ${round.roundNumber} rehearsal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    await this.improvementRoundRepository.update(round.id, {
      rehearsalRunId: rehearsal.id,
    });
    this.notify(run);

    // The trigger can fail synchronously inside createRehearsal (run comes
    // back FAILED) — the hook may have fired before rehearsalRunId/round
    // linkage was readable, so re-check here; the atomic round claim makes a
    // double call harmless.
    if (rehearsal.status !== RehearsalStatus.STARTED) {
      const current = await this.rehearsalService.getRehearsal(rehearsal.id);
      if (
        current.status === RehearsalStatus.FAILED ||
        current.status === RehearsalStatus.CANCELLED
      ) {
        await this.onRehearsalFinished(current);
      }
    }
  }

  // ------------------------------------------------------ gates + comparison

  private async computeDeltas(
    run: ImprovementRun,
    round: ImprovementRound,
    scores: Record<string, any>,
  ): Promise<{
    vsPrevious: RehearsalComparison | null;
    vsBaseline: RehearsalComparison | null;
  }> {
    const rounds = await this.improvementRoundRepository.listByRun(run.id);
    const previous = [...rounds]
      .filter((r) => r.roundNumber < round.roundNumber && r.scores)
      .sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const baseline = rounds.find(
      (r) => r.kind === ImprovementRoundKind.BASELINE && r.scores,
    );
    return {
      vsPrevious: previous
        ? this.comparisonService.compare(previous.scores, scores)
        : null,
      vsBaseline:
        baseline && baseline.id !== round.id
          ? this.comparisonService.compare(baseline.scores, scores)
          : null,
    };
  }

  /**
   * Deterministic-first stop condition:
   *  1. every selected test case PASSED this round (when required);
   *  2. no PASSED→FAILED flip vs the baseline;
   *  3. judged minimums (minOverall / minDimensions) as the secondary bar.
   */
  private evaluateTargets(
    scores: Record<string, any>,
    targets: Record<string, any>,
    vsBaseline: RehearsalComparison | null,
  ): boolean {
    const requireAllPass = targets.requireAllTestCasesPass ?? true;
    const counts = scores.test_counts ?? {};
    const totalCases =
      (counts.passed ?? 0) + (counts.failed ?? 0) + (counts.inconclusive ?? 0);
    if (requireAllPass && totalCases > 0) {
      if ((counts.failed ?? 0) > 0 || (counts.inconclusive ?? 0) > 0) {
        return false;
      }
    }
    if (
      vsBaseline?.testCases.some((testCase) => testCase.flip === 'REGRESSED')
    ) {
      return false;
    }
    if (
      typeof targets.minOverall === 'number' &&
      (scores.overall ?? 0) < targets.minOverall
    ) {
      return false;
    }
    for (const [name, minimum] of Object.entries(
      (targets.minDimensions ?? {}) as Record<string, number>,
    )) {
      if ((scores.dimensions?.[name] ?? 0) < minimum) return false;
    }
    return true;
  }

  /** Profiles whose judged scores miss the screen bar — cheap-round scope. */
  private failingProfiles(
    scores: Record<string, any>,
    targets: Record<string, any>,
  ): RehearsalTraineeProfile[] {
    const perProfile = (scores.per_profile ?? {}) as Record<
      string,
      Record<string, number>
    >;
    const minDimensions = (targets.minDimensions ?? {}) as Record<
      string,
      number
    >;
    const failing: RehearsalTraineeProfile[] = [];
    for (const [profile, profileScores] of Object.entries(perProfile)) {
      const misses = Object.entries(profileScores ?? {}).some(
        ([dimension, value]) =>
          value < (minDimensions[dimension] ?? DIMENSION_SCREEN_TARGET),
      );
      if (misses) failing.push(profile as RehearsalTraineeProfile);
    }
    return failing;
  }

  private failingTestCaseIds(scores: Record<string, any>): string[] {
    return ((scores.test_case_results ?? []) as Record<string, any>[])
      .filter((result) => result.verdict !== 'PASSED')
      .map((result) => String(result.test_case_id));
  }

  /**
   * Check the previous round's APPLIED proposals against their
   * expectedEffect using this round's deltas: test-case predictions exact,
   * dimension directions with a small tolerance. Only metrics measured this
   * round are judged — an unmeasured prediction leaves the proposal APPLIED.
   */
  private async verifyPreviousRoundProposals(
    run: ImprovementRun,
    round: ImprovementRound,
    vsPrevious: RehearsalComparison | null,
  ): Promise<void> {
    if (!vsPrevious) return;
    const proposals =
      await this.critiqueProposalRepository.listByImprovementRun(run.id);
    const toVerify = proposals.filter(
      (proposal) =>
        proposal.roundNumber === round.roundNumber - 1 &&
        proposal.status === CritiqueProposalStatus.APPLIED &&
        proposal.expectedEffect,
    );

    for (const proposal of toVerify) {
      const effect = proposal.expectedEffect ?? {};
      const observations: Record<string, any> = {
        dimensions: {},
        testCases: {},
      };
      let verdict: CritiqueProposalStatus | null = null;

      for (const expectation of (effect.dimensions ?? []) as Record<
        string,
        any
      >[]) {
        const delta = vsPrevious.dimensions[expectation.name]?.delta;
        if (delta === null || delta === undefined) continue;
        observations.dimensions[expectation.name] = delta;
        const satisfied =
          expectation.direction === 'decrease'
            ? delta <= IMPROVEMENT_VERIFICATION_TOLERANCE
            : delta >= -IMPROVEMENT_VERIFICATION_TOLERANCE;
        verdict = satisfied
          ? (verdict ?? CritiqueProposalStatus.VERIFIED)
          : CritiqueProposalStatus.FAILED_VERIFICATION;
      }

      for (const expectation of (effect.testCases ?? []) as Record<
        string,
        any
      >[]) {
        const comparison = vsPrevious.testCases.find(
          (testCase) => testCase.id === String(expectation.id),
        );
        if (!comparison?.after) continue;
        observations.testCases[String(expectation.id)] = comparison.after;
        const satisfied = comparison.after === expectation.expectedVerdict;
        verdict = satisfied
          ? (verdict ?? CritiqueProposalStatus.VERIFIED)
          : CritiqueProposalStatus.FAILED_VERIFICATION;
      }

      if (verdict !== null) {
        await this.critiqueProposalRepository.update(proposal.id, {
          status: verdict,
          verification: { observed: observations, verdict } as Record<
            string,
            any
          >,
        });
      }
    }
  }

  // ---------------------------------------------------------------- finishes

  /**
   * Stop iterating and hand over for review. Best round = full-scope scored
   * rounds ranked by tests passed, then judged overall, then dimension sum —
   * the deterministic signal outranks the noisy one.
   */
  private async finishRun(
    run: ImprovementRun,
    outcome: ImprovementRunOutcome,
  ): Promise<void> {
    const rounds = await this.improvementRoundRepository.listByRun(run.id);
    const scored = rounds.filter((round) => round.fullScope && round.scores);
    const rank = (round: ImprovementRound): [number, number, number] => {
      const scores = round.scores ?? {};
      const counts = scores.test_counts ?? {};
      const dimensionSum = Object.values(
        (scores.dimensions ?? {}) as Record<string, number>,
      ).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return [counts.passed ?? 0, scores.overall ?? 0, dimensionSum];
    };
    const best = [...scored].sort((a, b) => {
      const [aPassed, aOverall, aSum] = rank(a);
      const [bPassed, bOverall, bSum] = rank(b);
      return bPassed - aPassed || bOverall - aOverall || bSum - aSum;
    })[0];

    const baseline = rounds.find(
      (round) => round.kind === ImprovementRoundKind.BASELINE,
    );
    // "Ran out of rounds and never beat round 0" is the one stop reason that
    // NO_IMPROVEMENT states better; NO_PROPOSALS/TIMED_OUT already explain
    // themselves and must not be masked.
    let finalOutcome = outcome;
    if (
      best &&
      baseline &&
      best.id === baseline.id &&
      outcome === ImprovementRunOutcome.MAX_ROUNDS
    ) {
      finalOutcome = ImprovementRunOutcome.NO_IMPROVEMENT;
    }

    await this.improvementRunRepository.update(run.id, {
      status: ImprovementRunStatus.AWAITING_REVIEW,
      outcome: finalOutcome,
      bestVersionId: best?.candidateVersionId ?? null,
      bestRehearsalId: best?.rehearsalRunId ?? null,
      endedAt: new Date(),
    });
    await this.redisService.del(`${IMPROVEMENT_REDIS_KEY_PREFIX}:${run.id}`);
    this.notify(run);

    // Copilot-initiated runs auto-apply the winner: the trainer asked for a
    // hands-off loop, editing is locked client-side while it runs, and the
    // result stays reviewable (versions + chat trajectory).
    if (
      finalOutcome === ImprovementRunOutcome.TARGETS_MET &&
      run.config?.autoAcceptOnTargetsMet &&
      best
    ) {
      try {
        const accepted = await this.acceptRun(run.id, {}, run.createdBy);
        await this.narrationService.postReady(accepted);
        return;
      } catch (error) {
        this.logger.error(
          `Auto-accept failed for improvement run ${run.id}: ${
            error instanceof Error ? error.message : String(error)
          } — falling back to manual review`,
        );
      }
    }
    await this.narrationService.postFinished(
      await this.getRun(run.id),
      finalOutcome,
    );
  }

  private async failRun(
    run: ImprovementRun,
    outcome: ImprovementRunOutcome,
    errorMessage: string,
  ): Promise<void> {
    this.logger.error(
      `Improvement run ${run.id} failed (${outcome}): ${errorMessage}`,
    );
    await this.improvementRunRepository.update(run.id, {
      status: ImprovementRunStatus.FAILED,
      outcome,
      metadata: { ...(run.metadata ?? {}), errorMessage } as Record<
        string,
        any
      >,
      endedAt: new Date(),
    });
    await this.redisService.del(`${IMPROVEMENT_REDIS_KEY_PREFIX}:${run.id}`);
    this.notify(run);
    await this.narrationService.postFailed(
      await this.getRun(run.id),
      errorMessage,
    );
  }

  // ------------------------------------------------------------------ review

  /** Accept: copy the best version's spec into the working draft. */
  async acceptRun(
    runId: string,
    dto: ResolveImprovementRunDto,
    userId: number,
  ): Promise<ImprovementRun> {
    const run = await this.getRun(runId);
    if (run.status !== ImprovementRunStatus.AWAITING_REVIEW) {
      throw new BadRequestException(
        'Only a run awaiting review can be accepted',
      );
    }
    if (!run.bestVersionId) {
      throw new BadRequestException('Run has no reviewable result version');
    }
    const spec = await this.roleplaySpecService.getSpec(run.specId);
    if (
      dto.expectedDraftUpdatedAt &&
      new Date(dto.expectedDraftUpdatedAt).getTime() !==
        spec.updatedAt.getTime()
    ) {
      throw new ConflictException(
        'The draft changed while the improvement run was in progress; ' +
          'confirm overwriting it by retrying without the concurrency token',
      );
    }
    const bestVersion = await this.roleplaySpecService.getVersionById(
      run.bestVersionId,
    );
    const { version } = await this.roleplaySpecService.persistDraftMutation(
      spec,
      bestVersion.spec,
      userId,
      RoleplaySpecVersionSource.AUTO_IMPROVE_ACCEPTED,
    );
    await this.improvementRunRepository.update(runId, {
      status: ImprovementRunStatus.ACCEPTED,
      acceptedVersionId: version.id,
      resolvedBy: userId,
      updatedBy: userId,
    });
    this.notify(run);
    return this.getRun(runId);
  }

  async discardRun(runId: string, userId: number): Promise<ImprovementRun> {
    const run = await this.getRun(runId);
    if (run.status !== ImprovementRunStatus.AWAITING_REVIEW) {
      throw new BadRequestException(
        'Only a run awaiting review can be discarded',
      );
    }
    await this.improvementRunRepository.update(runId, {
      status: ImprovementRunStatus.DISCARDED,
      resolvedBy: userId,
      updatedBy: userId,
    });
    this.notify(run);
    return this.getRun(runId);
  }

  async cancelRun(runId: string, userId: number): Promise<SuccessResponse> {
    const run = await this.getRun(runId);
    if (run.status !== ImprovementRunStatus.RUNNING) {
      throw new BadRequestException(
        'Only a running improvement can be cancelled',
      );
    }
    // Flip the run first so the rehearsal-cancel hook sees a non-RUNNING run
    // and leaves the (already final) improvement state alone.
    await this.improvementRunRepository.update(runId, {
      status: ImprovementRunStatus.CANCELLED,
      resolvedBy: userId,
      updatedBy: userId,
      endedAt: new Date(),
    });
    await this.redisService.del(`${IMPROVEMENT_REDIS_KEY_PREFIX}:${runId}`);

    const rounds = await this.improvementRoundRepository.listByRun(runId);
    const active = rounds.find(
      (round) =>
        round.status === ImprovementRoundStatus.REHEARSING &&
        round.rehearsalRunId,
    );
    if (active?.rehearsalRunId) {
      try {
        await this.rehearsalService.cancelRehearsal(
          active.rehearsalRunId,
          run.createdBy,
        );
      } catch (error) {
        this.logger.warn(
          `Could not cancel in-flight rehearsal ${active.rehearsalRunId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.notify(run);
    return { success: true };
  }

  // ---------------------------------------------------------------- watchdog

  /** Redis-TTL expiry: finish a stalled RUNNING loop with its best-so-far. */
  async handleExpiredImprovement(runId: string): Promise<void> {
    const run = await this.improvementRunRepository.findOne({
      where: { id: runId },
    });
    if (!run || run.status !== ImprovementRunStatus.RUNNING) return;
    const timeoutMinutes = Number(run.config?.timeoutMinutes ?? 0);
    if (timeoutMinutes > 0) {
      const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
      if (run.createdAt > cutoff) return;
    }
    const rounds = await this.improvementRoundRepository.listByRun(runId);
    const hasScoredRound = rounds.some(
      (round) => round.fullScope && round.scores,
    );
    if (hasScoredRound) {
      this.logger.warn(
        `Improvement run ${runId} timed out — finishing with best-so-far`,
      );
      await this.finishRun(run, ImprovementRunOutcome.TIMED_OUT);
    } else {
      await this.failRun(
        run,
        ImprovementRunOutcome.TIMED_OUT,
        'Timed out before any round completed',
      );
    }
  }

  // ----------------------------------------------------------------- helpers

  private hashOps(ops: JsonPatchOp[]): string {
    return createHash('sha1')
      .update(JSON.stringify(ops ?? []))
      .digest('hex');
  }

  private notify(run: ImprovementRun): void {
    this.notificationService.notifyUpdate(run.createdBy, run.id);
  }
}
