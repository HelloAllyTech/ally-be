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
import { FillerBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  FillerJudgeAiResult,
  FillerJudgeRepository,
  FillerObservation,
  FillerSessionRow,
} from '../repository/filler-judge.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  result: FillerJudgeAiResult;
}

/**
 * Owns thinking-filler judging end to end (sibling of LanguageJudgeService,
 * same seam): ally-be selects which sessions to judge, builds the played-filler
 * observations from its own tables, calls ally-ai's stateless judge over HTTP,
 * and persists the denominator row plus per-finding annotations itself. ally-ai
 * never touches this database.
 *
 * What this measures and why it needed its own judge: the filler's SPEED is
 * already recorded per turn. Its quality was not measured at all, and because
 * the filler is the character's first words, `responseLatencyMs` is measured to
 * it — so a filler that lands instantly but sounds nothing like the character
 * improves every latency chart while making the roleplay worse.
 *
 * Job state is persisted in Redis (ally-be is load-balanced; POST and status
 * polls can land on different instances).
 */
@Injectable()
export class FillerJudgeService {
  private readonly logger = LoggerService.getInstance(FillerJudgeService.name);

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: FillerJudgeRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `filler:backfill:job:${jobId}`;
  }

  private async saveJob(job: FillerBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      FillerJudgeService.JOB_TTL_SECONDS,
    );
  }

  /** Start an async backfill over a window; returns a job id to poll. */
  async startBackfill(opts: {
    since?: string;
    until?: string;
    language?: string;
    scenarioId?: number;
    limit?: number;
    rejudge?: boolean;
    concurrency?: number | null;
  }): Promise<FillerBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(opts.concurrency ?? null);
    const jobId = randomUUID();
    const job: FillerBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      findings: 0,
      skipped: 0,
      failed: 0,
      error: null,
    };
    await this.saveJob(job);
    // Fire-and-forget: the HTTP request returns immediately with the job id.
    void this.runJob(job, opts, concurrency);
    this.logger.debug(
      `filler backfill queued job=${jobId} since=${opts.since ?? 'any'}`,
    );
    return { ...job };
  }

  async getJob(jobId: string): Promise<FillerBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as FillerBackfillJobDto) : undefined;
  }

  private async runJob(
    job: FillerBackfillJobDto,
    opts: {
      since?: string;
      until?: string;
      language?: string;
      scenarioId?: number;
      limit?: number;
      rejudge?: boolean;
    },
    concurrency: number,
  ): Promise<void> {
    try {
      const { judgeModel, judgePromptVersion } = await this.probeJudgeVersion();
      const sessions = await this.repo.selectSessions({
        ...opts,
        judgeModel,
        judgePromptVersion,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);

      // Independent per session, so run a bounded pool rather than one at a
      // time — the LLM call dominates each iteration.
      await runWithConcurrency(sessions, concurrency, async (s) => {
        try {
          const observations = await this.repo.buildObservations(s.id);
          if (observations.length === 0) {
            // The selector required at least one played filler, so an empty
            // list here means the marker is missing on this session's rows —
            // an older worker. Skipped rather than judged: sending nothing
            // would persist a zero-denominator row that reads like a clean
            // session when it is really an unmeasurable one.
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }
          const judged = await this.judgeViaAi(observations, s);
          await this.repo.persistJudgment(
            s,
            judged.result,
            judged.judgeModel,
            judged.judgePromptVersion,
          );
          job.judged += 1;
          job.findings += judged.result.per_filler.reduce(
            (n, f) => n + f.findings.length,
            0,
          );
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad session must not abort the whole job.
          this.logger.error(
            `filler backfill: session ${s.id} failed: ${(e as Error).message}`,
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
        `filler backfill job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /**
   * Ask ally-ai which judge version it is running, before selecting sessions.
   *
   * The selector skips sessions already judged by this exact (model, rubric
   * version) pair, so it needs the pair up front — and hard-coding it here
   * would silently re-judge everything the day ally-ai bumps its rubric, or
   * silently skip everything if the two drifted apart. An empty observation
   * list is a valid, cheap request that the judge answers without an LLM call.
   */
  private async probeJudgeVersion(): Promise<{
    judgeModel: string;
    judgePromptVersion: string;
  }> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/filler-quality/judge`,
      { observations: [], persona: '', language: 'en' },
      { headers: { 'x-api-key': outboundApiKey }, timeout: 15000 },
    );
    return {
      judgeModel: res.data.judge_model,
      judgePromptVersion: res.data.judge_prompt_version,
    };
  }

  /** Call ally-ai's stateless filler judge over HTTP. */
  private async judgeViaAi(
    observations: FillerObservation[],
    s: FillerSessionRow,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    // Held inside the GLOBAL judge slot: the ceiling has to span every
    // backfill at once, not just this job's own pool.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/filler-quality/judge`,
        {
          observations,
          persona: s.persona ?? '',
          language: s.language,
          // Without the style block the judge cannot tell a model failure from
          // an unconfigured scenario, and marks every generic filler down.
          style_config: {
            language_label: s.language_label ?? undefined,
            style_exemplars: s.style_exemplars ?? [],
            allowed_fillers: s.allowed_fillers ?? [],
          },
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    return {
      judgeModel: res.data.judge_model,
      judgePromptVersion: res.data.judge_prompt_version,
      result: res.data.result as FillerJudgeAiResult,
    };
  }
}
