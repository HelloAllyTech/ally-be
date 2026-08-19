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
import { DriftBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  DriftJudgeRepository,
  PerTurnJudgment,
  SessionRollup,
  TranscriptTurn,
} from '../repository/drift-judge.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  perTurn: PerTurnJudgment[];
  rollup: SessionRollup;
}

/**
 * What the labels-only judge returns per turn: the fields the v2 rubric
 * added, and nothing else. Every one is optional — a label the judge
 * declines to emit must stay NULL so the turn leaves the denominator,
 * rather than becoming a `false` in some rate's numerator.
 */
interface LeanTurnLabels {
  turn_index: number;
  role_inversion?: boolean | null;
  offered_solution?: boolean | null;
  solutions_offered?: number | null;
  resistance_briefed?: boolean | null;
  introduced_new_information?: boolean | null;
  stuck_is_appropriate?: boolean | null;
  reasoning?: string | null;
}

/**
 * Owns conversation-drift judging end to end. ally-be owns the session data, so
 * it selects which sessions to judge, builds each transcript, calls ally-ai's
 * stateless judge over HTTP, and persists the per-turn rows itself — ally-ai
 * never touches this database.
 *
 * Backfill runs as a background job (the Gemini judge is slow and a 3-month run
 * is long). Job state is persisted in Redis — NOT process memory — because
 * ally-be is load-balanced across instances: the POST that creates the job and
 * the GET status polls can land on different instances, so the registry must be
 * shared. The processing loop runs on the instance that received the POST and
 * writes progress to Redis; any instance's poll reads it.
 */
@Injectable()
export class DriftJudgeService {
  private readonly logger = LoggerService.getInstance(DriftJudgeService.name);

  // TTL refreshes on each update, so an active job stays alive; a finished job
  // lingers ~1h for the UI to read the terminal state, then expires.
  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: DriftJudgeRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `drift:backfill:job:${jobId}`;
  }

  private async saveJob(job: DriftBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      DriftJudgeService.JOB_TTL_SECONDS,
    );
  }

  /** Start an async backfill over a window; returns a job id to poll. */
  async startBackfill(
    sinceDays = 90,
    onlyUnjudged = false,
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
    /**
     * Lean mode: judge ONLY the labels the current rubric added, copying every
     * other field forward from a session's existing judgment under THIS source
     * version. Roughly a quarter of the cost of a full re-judge, and valid only
     * because the rubric change added labels rather than redefining existing
     * ones. Null = the ordinary full judge, which is what live traffic uses.
     */
    leanFromVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    /**
     * Cap on how many sessions this run takes on.
     *
     * The drainer passes a chunk size so a run finishes well inside one tick.
     * That is what makes a restart cheap: the selector already skips anything
     * already judged, so an interrupted chunk costs only the sessions in
     * flight, and the next tick simply picks up the next batch.
     */
    limit?: number | null,
  ): Promise<DriftBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const jobId = randomUUID();
    const job: DriftBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      drifted: 0,
      skipped: 0,
      failed: 0,
      error: null,
    };
    await this.saveJob(job);
    // Fire-and-forget: the HTTP request returns immediately with the job id.
    void this.runJob(
      job,
      sinceDays,
      onlyUnjudged,
      unjudgedForVersion ?? null,
      concurrency,
      leanFromVersion ?? null,
      limit ?? null,
    );
    this.logger.debug(
      `drift backfill queued job=${jobId} sinceDays=${sinceDays} ` +
        `onlyUnjudged=${onlyUnjudged} concurrency=${concurrency} ` +
        `mode=${leanFromVersion ? 'lean' : 'full'}`,
    );
    return { ...job };
  }

  async getJob(jobId: string): Promise<DriftBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as DriftBackfillJobDto) : undefined;
  }

  private async runJob(
    job: DriftBackfillJobDto,
    sinceDays: number,
    onlyUnjudged: boolean,
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    concurrency: number,
    leanFromVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    limit: number | null,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const sessions = await this.repo.selectSessions({
        sinceDays,
        onlyUnjudged,
        unjudgedForVersion,
        // Lean mode has nothing to copy forward for a session that was never
        // judged, so those are excluded from the run rather than attempted.
        judgedForVersion: leanFromVersion,
        limit,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);
      // Sessions are independent — different rows, different transcripts — so
      // they run in a bounded pool rather than one at a time.
      await runWithConcurrency(sessions, concurrency, async (s) => {
        try {
          const { transcript, aiText, userText } =
            await this.repo.buildTranscript(s.id);
          if (Object.keys(aiText).length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }
          if (leanFromVersion) {
            // Labels-only top-up. No rollup is recomputed: `drifted` and
            // `firstDriftTurn` derive from the v1 labels this pass does not
            // re-emit, and the row being copied forward already carries them.
            const lean = await this.leanLabelsViaAi(
              transcript,
              s.persona ?? '',
              s.language,
              rubric,
            );
            await this.repo.mergeLeanLabels(
              s.id,
              lean.perTurn,
              leanFromVersion,
              {
                judgeModel: lean.judgeModel,
                judgePromptVersion: lean.judgePromptVersion,
              },
            );
            job.judged += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const judged = await this.judgeViaAi(
            transcript,
            s.persona ?? '',
            s.language,
            rubric,
          );
          await this.repo.upsertJudgments(
            s,
            judged.perTurn,
            judged.rollup,
            judged.judgeModel,
            judged.judgePromptVersion,
            aiText,
            userText,
          );
          job.judged += 1;
          job.drifted += judged.rollup.drifted ? 1 : 0;
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad session must not abort the whole job.
          this.logger.error(
            `drift backfill: session ${s.id} failed: ${(e as Error).message}`,
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
        `drift backfill job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /**
   * Call ally-ai's labels-only judge — same rubric, constrained response.
   *
   * Separate from `judgeViaAi` rather than a flag on it, so the live path
   * cannot reach this by accident: a session judged for the first time through
   * this endpoint would produce a row with no coherence, failure mode or
   * attribution at all.
   */
  private async leanLabelsViaAi(
    transcript: TranscriptTurn[],
    persona: string,
    language: string,
    rubric: string | null,
  ): Promise<{
    judgeModel: string;
    judgePromptVersion: string;
    perTurn: LeanTurnLabels[];
  }> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/drift/judge-labels`,
        { transcript, persona, language, rubric },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      per_turn: LeanTurnLabels[];
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      perTurn: d.per_turn ?? [],
    };
  }

  /** Call ally-ai's stateless judge over HTTP. */
  private async judgeViaAi(
    transcript: TranscriptTurn[],
    persona: string,
    language: string,
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    // Held inside the GLOBAL judge slot: the ceiling has to span every
    // backfill at once, not just this job's own pool.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/drift/judge`,
        { transcript, persona, language, rubric },
        {
          headers: { 'x-api-key': outboundApiKey },
          // The judge is a single Gemini call over a whole transcript — allow time.
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      result: { per_turn: PerTurnJudgment[]; session: SessionRollup };
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      perTurn: d.result.per_turn,
      rollup: d.result.session,
    };
  }
}
