import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  resolveJudgeConcurrency,
  runWithConcurrency,
  withJudgeSlot,
} from '../util/judge-concurrency.util';
import { GroundednessBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  ClaimJudgment,
  FeedbackClaim,
  FeedbackGroundednessRepository,
  TranscriptTurn,
} from '../repository/feedback-groundedness.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  claims: ClaimJudgment[];
}

/**
 * Owns feedback-groundedness judging end to end: selects sessions whose
 * feedback has checkable claims, assembles the claims and transcript, calls
 * ally-ai's stateless judge, and persists the verdicts. ally-ai never touches
 * this database.
 *
 * Job state lives in Redis rather than process memory for the same reason as
 * the drift backfill: ally-be is load-balanced, so the POST that starts a job
 * and the GET that polls it can land on different instances.
 *
 * This backfill is the most expensive of the three — a year of feedback is
 * ~2,673 objects, each a Gemini call over a full transcript — so it is worth
 * confirming judge usage emission is switched on before starting a long run,
 * or the spend arrives as an invoice rather than a dashboard.
 */
@Injectable()
export class FeedbackGroundednessJudgeService {
  private readonly logger = LoggerService.getInstance(
    FeedbackGroundednessJudgeService.name,
  );

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: FeedbackGroundednessRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `groundedness:backfill:job:${jobId}`;
  }

  private async saveJob(job: GroundednessBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      FeedbackGroundednessJudgeService.JOB_TTL_SECONDS,
    );
  }

  async getJob(jobId: string): Promise<GroundednessBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as GroundednessBackfillJobDto) : undefined;
  }

  /** Start an async backfill over a window; returns a job id to poll. */
  async startBackfill(
    sinceDays = 365,
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
  ): Promise<GroundednessBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const jobId = randomUUID();
    const job: GroundednessBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      skipped: 0,
      failed: 0,
      claimsJudged: 0,
      claimsUngrounded: 0,
      error: null,
    };
    await this.saveJob(job);
    void this.runJob(job, sinceDays, unjudgedForVersion ?? null, concurrency);
    this.logger.debug(
      `groundedness backfill queued job=${jobId} sinceDays=${sinceDays} ` +
        `version=${unjudgedForVersion?.judgePromptVersion ?? 'any'}`,
    );
    return { ...job };
  }

  private async runJob(
    job: GroundednessBackfillJobDto,
    sinceDays: number,
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    concurrency: number,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const sessions = await this.repo.selectSessions({
        sinceDays,
        unjudgedForVersion,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);

      // Independent per session; the LLM call dominates, so run a bounded pool.
      await runWithConcurrency(sessions, concurrency, async (s) => {
        try {
          const [claims, transcript] = await Promise.all([
            this.repo.buildClaims(s.id),
            this.repo.buildTranscript(s.id),
          ]);

          // Nothing checkable, or nothing to check it against. Skipped rather
          // than judged: recording "0 ungrounded claims" here would report a
          // session with no feedback as perfectly grounded feedback.
          if (claims.length === 0 || transcript.length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const judged = await this.judgeViaAi(
            transcript,
            claims,
            s.language,
            rubric,
          );
          await this.repo.upsertJudgments(
            s,
            claims,
            judged.claims,
            judged.judgeModel,
            judged.judgePromptVersion,
          );

          job.judged += 1;
          job.claimsJudged += judged.claims.length;
          job.claimsUngrounded += judged.claims.filter(
            (c) => c.verdict !== 'supported',
          ).length;
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad session must not abort a run that may take hours.
          this.logger.error(
            `groundedness backfill: session ${s.id} failed: ${
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
        `groundedness backfill job ${job.jobId} failed: ${
          (e as Error).message
        }`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /** Call ally-ai's stateless groundedness judge over HTTP. */
  private async judgeViaAi(
    transcript: TranscriptTurn[],
    claims: FeedbackClaim[],
    language: string,
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    // Held inside the GLOBAL judge slot: the ceiling has to span every
    // backfill at once, not just this job's own pool.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/feedback-groundedness/judge`,
        { transcript, claims, language, rubric },
        {
          headers: { 'x-api-key': outboundApiKey },
          // One Gemini call over a whole transcript plus every claim.
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      claims: ClaimJudgment[];
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      claims: d.claims ?? [],
    };
  }
}
