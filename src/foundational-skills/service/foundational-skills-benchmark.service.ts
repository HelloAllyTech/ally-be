import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  FHS_MAX_ATTEMPTS,
  FHS_RUBRIC_VERSION,
  FHS_SCORE_CONCURRENCY,
} from '../constants/helping-skills-rubric.constants';
import {
  FHS_BENCHMARK_MIN_LEARNER_CHARS,
  FHS_BENCHMARKS_PER_TICK,
} from '../constants/fhs-benchmark.constants';
import { FhsBenchmarkStatus } from '../enum/foundational-skills.enum';
import {
  BenchmarkAssessmentWrite,
  BenchmarkSessionToScore,
  FoundationalSkillsRepository,
} from '../repository/foundational-skills.repository';
import { storedJudgement } from '../util/skill-scoring.util';
import { learnerCharsOf, renderSession } from '../util/transcript-window.util';
import { FoundationalSkillsJudgeService } from './foundational-skills-judge.service';

export interface BenchmarkTickSummary {
  benchmarksScored: number;
  benchmarksSkipped: number;
  benchmarksFailed: number;
  /** Benchmark rows whose practice dose was recounted this tick. */
  cutsBeforeRefreshed: number;
}

export const EMPTY_BENCHMARK_TICK: BenchmarkTickSummary = {
  benchmarksScored: 0,
  benchmarksSkipped: 0,
  benchmarksFailed: 0,
  cutsBeforeRefreshed: 0,
};

/**
 * Scores completed sessions of benchmark roleplays — the fixed-scenario
 * before/after measure (see constants/fhs-benchmark.constants.ts).
 *
 * Each session is judged WHOLE by the same judge, rubric, prompt and pinned
 * model as a cut, and its levels are derived the same way, so a benchmark
 * score and a cut score are on one ruler. Runs inside the foundational-skills
 * scheduler tick, after cut sealing (so the practice dose it records is
 * current); nothing on a request path calls it.
 */
@Injectable()
export class FoundationalSkillsBenchmarkService {
  private readonly logger = LoggerService.getInstance(
    FoundationalSkillsBenchmarkService.name,
  );

  constructor(
    private readonly repository: FoundationalSkillsRepository,
    private readonly judge: FoundationalSkillsJudgeService,
  ) {}

  /** Recount stale doses, then score a bounded batch of pending sessions. */
  async tick(): Promise<BenchmarkTickSummary> {
    const cutsBeforeRefreshed =
      await this.repository.refreshBenchmarkCutsBefore();
    const queue = await this.repository.findBenchmarkSessionsToScore(
      FHS_RUBRIC_VERSION,
      FHS_MAX_ATTEMPTS,
      FHS_BENCHMARKS_PER_TICK,
    );
    const summary = { ...EMPTY_BENCHMARK_TICK, cutsBeforeRefreshed };

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const status = await this.scoreSession(next);
        if (status === FhsBenchmarkStatus.SCORED) summary.benchmarksScored += 1;
        else if (status === FhsBenchmarkStatus.SKIPPED)
          summary.benchmarksSkipped += 1;
        else summary.benchmarksFailed += 1;
      }
    };
    await Promise.all(
      Array.from({ length: FHS_SCORE_CONCURRENCY }, () => worker()),
    );
    return summary;
  }

  /**
   * Score one session and record the outcome. Never throws: a failure becomes
   * a FAILED row (retried later), too little learner speech becomes a SKIPPED
   * row with no model call.
   */
  async scoreSession(
    target: BenchmarkSessionToScore,
  ): Promise<FhsBenchmarkStatus> {
    const base = {
      sessionId: target.sessionId,
      userId: target.userId,
      scenarioId: target.scenarioId,
      tenantId: target.tenantId,
      sessionEndedAt: target.endedAt,
      rubricVersion: FHS_RUBRIC_VERSION,
      cutsBefore: target.cutsBefore,
    };
    let learnerChars = 0;
    try {
      const turns = await this.repository.loadTurns([target.sessionId]);
      const session = {
        sessionId: target.sessionId,
        endedAt: target.endedAt,
        tenantId: target.tenantId,
        turns: turns.get(target.sessionId) ?? [],
      };
      learnerChars = learnerCharsOf(session);

      if (learnerChars < FHS_BENCHMARK_MIN_LEARNER_CHARS) {
        await this.repository.upsertBenchmarkAssessment({
          ...base,
          ...unscored(),
          status: FhsBenchmarkStatus.SKIPPED,
          learnerChars,
          error:
            `Learner spoke ${learnerChars} characters; a benchmark session needs ` +
            `at least ${FHS_BENCHMARK_MIN_LEARNER_CHARS} to be scored`,
        });
        return FhsBenchmarkStatus.SKIPPED;
      }

      const rendered = renderSession(session);
      if (!rendered || rendered.helperLines === 0) {
        throw new Error('Session has no helper lines to score');
      }

      const outcome = await this.judge.judgeBenchmark(
        rendered.text,
        rendered.lines,
        {
          sessionId: target.sessionId,
          userId: target.userId,
          scenarioId: target.scenarioId,
        },
      );
      const { verdicts, skillLevels } = storedJudgement(outcome.verdicts);

      await this.repository.upsertBenchmarkAssessment({
        ...base,
        status: FhsBenchmarkStatus.SCORED,
        model: outcome.model,
        compositeScore: outcome.compositeScore,
        hasUnhelpfulBehaviour: outcome.hasUnhelpfulBehaviour,
        skillLevels,
        verdicts,
        droppedTicks: outcome.stats.droppedTicks,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        learnerChars,
        error: null,
      });
      return FhsBenchmarkStatus.SCORED;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 500);
      this.logger.warn(
        `foundational-skills: scoring benchmark session ${target.sessionId} failed ` +
          `(attempt ${target.attempts + 1}): ${message}`,
      );
      await this.repository
        .upsertBenchmarkAssessment({
          ...base,
          ...unscored(),
          status: FhsBenchmarkStatus.FAILED,
          learnerChars,
          error: message,
        })
        .catch(() => undefined);
      return FhsBenchmarkStatus.FAILED;
    }
  }
}

/** The score columns of a row that carries no judgement. */
function unscored(): Pick<
  BenchmarkAssessmentWrite,
  | 'model'
  | 'compositeScore'
  | 'hasUnhelpfulBehaviour'
  | 'skillLevels'
  | 'verdicts'
  | 'droppedTicks'
  | 'promptTokens'
  | 'completionTokens'
> {
  return {
    model: null,
    compositeScore: null,
    hasUnhelpfulBehaviour: null,
    skillLevels: {},
    verdicts: [],
    droppedTicks: 0,
    promptTokens: null,
    completionTokens: null,
  };
}
