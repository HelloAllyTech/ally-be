import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  FHS_CONTEXT_CHARS,
  FHS_CUT_LEARNER_CHARS,
  FHS_RUBRIC_VERSION,
} from '../constants/helping-skills-rubric.constants';
import { StoredSkillVerdict } from '../entity/foundational-skill-assessment.entity';
import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';
import {
  CutToScore,
  FoundationalSkillsRepository,
} from '../repository/foundational-skills.repository';
import {
  SessionTranscript,
  planCuts,
  renderWindow,
  turnsAfter,
} from '../util/transcript-window.util';
import { FoundationalSkillsJudgeService } from './foundational-skills-judge.service';

/** Learners cut per tick. Cutting is SQL + arithmetic; this bounds the read. */
export const FHS_LEARNERS_PER_TICK = 200;
/**
 * Cuts scored per tick. Tasks in a scheduler bucket run one after another, so a
 * tick must stay short: 24 calls at 4 in flight is a few minutes at worst, and
 * still clears a backlog of ~1,000 cuts inside a day.
 */
export const FHS_CUTS_PER_TICK = 24;
export const FHS_SCORE_CONCURRENCY = 4;
/** A cut that fails this many times stays FAILED until someone looks. */
export const FHS_MAX_ATTEMPTS = 3;

export interface TickSummary {
  learnersCut: number;
  cutsSealed: number;
  cutsScored: number;
  cutsFailed: number;
}

/**
 * The passive foundational-skills measure: cut each learner's practice into
 * equal amounts of their own speech, then score every cut against the fixed
 * helping-skills rubric. Runs from the scheduler; nothing on a request path calls it.
 */
@Injectable()
export class FoundationalSkillsService {
  private readonly logger = LoggerService.getInstance(
    FoundationalSkillsService.name,
  );

  constructor(
    private readonly repository: FoundationalSkillsRepository,
    private readonly judge: FoundationalSkillsJudgeService,
  ) {}

  async tick(): Promise<TickSummary> {
    const cutting = await this.sealNewCuts();
    const scoring = await this.scorePendingCuts();
    const summary = { ...cutting, ...scoring };
    if (summary.cutsSealed || summary.cutsScored || summary.cutsFailed) {
      this.logger.info(
        `foundational-skills tick: sealed=${summary.cutsSealed} ` +
          `(learners=${summary.learnersCut}) scored=${summary.cutsScored} ` +
          `failed=${summary.cutsFailed} version=${FHS_RUBRIC_VERSION}`,
      );
    }
    return summary;
  }

  /** Close every cut the pending speech now allows, for up to N learners. */
  async sealNewCuts(): Promise<
    Pick<TickSummary, 'learnersCut' | 'cutsSealed'>
  > {
    const learners = await this.repository.findLearnersReadyToCut(
      FHS_CUT_LEARNER_CHARS,
      FHS_LEARNERS_PER_TICK,
    );
    let cutsSealed = 0;
    for (const userId of learners) {
      try {
        cutsSealed += await this.sealForLearner(userId);
      } catch (error) {
        // One learner's odd data must not stop everyone else's cuts.
        this.logger.error(
          `foundational-skills: cutting failed for user ${userId}: ${
            (error as Error)?.message ?? error
          }`,
        );
      }
    }
    return { learnersCut: learners.length, cutsSealed };
  }

  async sealForLearner(userId: number): Promise<number> {
    const last = await this.repository.findLastCut(userId);
    const pending = await this.repository.findPendingSessions(userId);

    const carryId = last?.endsMidSession ? last.endSessionId : null;
    const headers = carryId
      ? await this.repository.findSessionHeaders([carryId])
      : [];
    const turns = await this.repository.loadTurns([
      ...(carryId ? [carryId] : []),
      ...pending.map((p) => p.sessionId),
    ]);

    const carry: SessionTranscript | null =
      carryId && last && headers[0]
        ? turnsAfter(
            { ...headers[0], turns: turns.get(carryId) ?? [] },
            last.endMessageId,
          )
        : null;
    const sessions = pending.map((p) => ({
      ...p,
      turns: turns.get(p.sessionId) ?? [],
    }));

    const cuts = planCuts(carry, sessions, FHS_CUT_LEARNER_CHARS);
    if (cuts.length === 0) return 0;
    return this.repository.insertCuts(userId, (last?.cutIndex ?? 0) + 1, cuts);
  }

  /** Score a bounded batch of cuts that have no result under this version. */
  async scorePendingCuts(): Promise<
    Pick<TickSummary, 'cutsScored' | 'cutsFailed'>
  > {
    const queue = await this.repository.findCutsToScore(
      FHS_RUBRIC_VERSION,
      FHS_MAX_ATTEMPTS,
      FHS_CUTS_PER_TICK,
    );
    let cutsScored = 0;
    let cutsFailed = 0;

    const worker = async () => {
      for (let cut = queue.shift(); cut; cut = queue.shift()) {
        const ok = await this.scoreCut(cut);
        if (ok) cutsScored += 1;
        else cutsFailed += 1;
      }
    };
    await Promise.all(
      Array.from({ length: FHS_SCORE_CONCURRENCY }, () => worker()),
    );
    return { cutsScored, cutsFailed };
  }

  async scoreCut(cut: CutToScore): Promise<boolean> {
    try {
      const turns = await this.repository.loadTurns(cut.sessionIds);
      const sessions = new Map(
        cut.sessionIds.map((id) => [
          id,
          {
            sessionId: id,
            endedAt: new Date(0),
            tenantId: null,
            turns: turns.get(id) ?? [],
          },
        ]),
      );
      const rendered = renderWindow(sessions, cut, FHS_CONTEXT_CHARS);
      if (rendered.helperLines === 0) {
        throw new Error('Cut has no helper lines left to score');
      }

      const outcome = await this.judge.judge(rendered.text, rendered.lines, {
        cutId: cut.cutId,
        userId: cut.userId,
        cutIndex: cut.cutIndex,
      });

      const verdicts: StoredSkillVerdict[] = outcome.verdicts.map((v) => ({
        skill: v.skill,
        opportunity: v.opportunity,
        level: v.level,
        observed: v.observed,
        notApplicable: v.notApplicable,
      }));
      const skillLevels = Object.fromEntries(
        outcome.verdicts
          .filter((v) => v.level !== null)
          .map((v) => [v.skill, v.level as number]),
      );

      await this.repository.upsertAssessment({
        cutId: cut.cutId,
        rubricVersion: FHS_RUBRIC_VERSION,
        status: FhsAssessmentStatus.SCORED,
        model: outcome.model,
        compositeScore: outcome.compositeScore,
        hasUnhelpfulBehaviour: outcome.hasUnhelpfulBehaviour,
        skillLevels,
        verdicts,
        droppedTicks: outcome.stats.droppedTicks,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        error: null,
      });
      return true;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 500);
      this.logger.warn(
        `foundational-skills: scoring cut ${cut.cutId} failed (attempt ${
          cut.attempts + 1
        }): ${message}`,
      );
      await this.repository
        .upsertAssessment({
          cutId: cut.cutId,
          rubricVersion: FHS_RUBRIC_VERSION,
          status: FhsAssessmentStatus.FAILED,
          model: null,
          compositeScore: null,
          hasUnhelpfulBehaviour: null,
          skillLevels: {},
          verdicts: [],
          droppedTicks: 0,
          promptTokens: null,
          completionTokens: null,
          error: message,
        })
        .catch(() => undefined);
      return false;
    }
  }
}
