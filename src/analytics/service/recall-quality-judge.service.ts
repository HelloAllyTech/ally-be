import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';

import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { RecallQualityBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  RecallJudgmentInput,
  RecallQualityRepository,
  RecallTurnRow,
} from '../repository/recall-quality.repository';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  resolveJudgeConcurrency,
  runWithConcurrency,
  withJudgeSlot,
} from '../util/judge-concurrency.util';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  judgment: RecallJudgmentInput | null;
}

/**
 * Judges whether the voice agent's client recalled the fact each turn called for.
 *
 * Same division as the other five families: ally-be selects the turns, pairs each recall
 * decision with its turn out of its own transcript, and persists the labels; ally-ai is a
 * stateless judge. Job state lives in Redis because ally-be is load-balanced.
 *
 * THE PAIRING IS THE RISK, and it is why a turn is SKIPPED rather than judged whenever the
 * transcript cannot support its index. `turnIndex` counts learner turns 1-based; if that ever
 * drifts from the transcript, a judge fed the wrong turn does not fail — it answers
 * confidently about a conversation that never happened, and the verdicts would look exactly
 * like real findings.
 */
@Injectable()
export class RecallQualityJudgeService {
  private readonly logger = LoggerService.getInstance(
    RecallQualityJudgeService.name,
  );

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: RecallQualityRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `recall-quality:backfill:job:${jobId}`;
  }

  private async saveJob(job: RecallQualityBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      RecallQualityJudgeService.JOB_TTL_SECONDS,
    );
  }

  async getJob(
    jobId: string,
  ): Promise<RecallQualityBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as RecallQualityBackfillJobDto) : undefined;
  }

  async startBackfill(
    sinceDays = 7,
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
    limit?: number | null,
  ): Promise<RecallQualityBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const jobId = randomUUID();
    const job: RecallQualityBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      skipped: 0,
      missedBetter: 0,
      nothingApt: 0,
      noDemand: 0,
      failed: 0,
      error: null,
    };
    await this.saveJob(job);
    void this.runJob(
      job,
      sinceDays,
      unjudgedForVersion ?? null,
      concurrency,
      limit ?? null,
    );
    this.logger.debug(
      `recall-quality backfill queued job=${jobId} sinceDays=${sinceDays} ` +
        `version=${unjudgedForVersion?.judgePromptVersion ?? 'any'}`,
    );
    return { ...job };
  }

  private async runJob(
    job: RecallQualityBackfillJobDto,
    sinceDays: number,
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    concurrency: number,
    limit: number | null,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const turns = await this.repo.selectTurns({
        sinceDays,
        unjudgedForVersion,
        limit,
      });
      job.status = 'running';
      job.total = turns.length;
      await this.saveJob(job);

      await runWithConcurrency(turns, concurrency, async (turn) => {
        try {
          const text = await this.repo.buildTurnText(
            turn.scenario_session_id,
            turn.turn_index,
          );

          // The transcript cannot support this index. Skipped rather than judged on whatever
          // is nearby: a verdict on the wrong turn is worse than no verdict, because nothing
          // downstream could tell it was wrong.
          if (!text) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const judged = await this.judgeViaAi(turn, text, rubric);

          // No verdict means OUR call failed — not that the turn needed nothing, which is
          // `no_demand` and a real label. Counting them together would quietly inflate the
          // healthy bucket with our own outages.
          if (!judged.judgment) {
            job.failed += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          await this.repo.upsertJudgment(
            turn,
            judged.judgment,
            judged.judgeModel,
            judged.judgePromptVersion,
          );

          job.judged += 1;
          if (judged.judgment.verdict === 'missed_better')
            job.missedBetter += 1;
          if (judged.judgment.verdict === 'nothing_apt') job.nothingApt += 1;
          if (judged.judgment.verdict === 'no_demand') job.noDemand += 1;
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad turn must not abort a run over thousands.
          this.logger.error(
            `recall-quality backfill: turn ${turn.id} failed: ${
              (e as Error).message
            }`,
          );
          job.failed += 1;
          job.processed += 1;
          await this.saveJob(job);
        }
      });

      job.status = 'done';
      await this.saveJob(job);
    } catch (e) {
      this.logger.error(
        `recall-quality backfill job ${job.jobId} failed: ${
          (e as Error).message
        }`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /** Call ally-ai's stateless recall judge over HTTP. */
  private async judgeViaAi(
    turn: RecallTurnRow,
    text: { counsellor_turn: string; client_reply: string },
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    // Inside the GLOBAL judge slot: the ceiling spans every family at once, because core-ai
    // has been taken down by exactly this kind of fan-out before.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/recall-quality/judge`,
        {
          counsellor_turn: text.counsellor_turn,
          client_reply: text.client_reply,
          selected: turn.selected ?? [],
          passed_over: turn.passed_over ?? [],
          stance: turn.stance,
          cue_tier: turn.cue_tier,
          rubric,
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      judgment: RecallJudgmentInput | null;
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      judgment: d.judgment ?? null,
    };
  }
}
