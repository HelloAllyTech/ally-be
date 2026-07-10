import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { LanguageBackfillJobDto } from '../dto/platform-analytics.dto';
import { DriftJudgeRepository } from '../repository/drift-judge.repository';
import {
  LanguageJudgeAiResult,
  LanguageJudgeRepository,
  LanguageSessionRow,
} from '../repository/language-judge.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  result: LanguageJudgeAiResult;
}

/**
 * Owns language-quality judging end to end (sibling of DriftJudgeService, same
 * seam): ally-be selects which sessions to judge, builds each transcript
 * (reusing the drift repository's builder — one transcript definition for both
 * judges), calls ally-ai's stateless judge over HTTP, and persists the
 * session-denominator row + per-error annotations itself. ally-ai never
 * touches this database.
 *
 * Job state is persisted in Redis (ally-be is load-balanced; POST and status
 * polls can land on different instances).
 */
@Injectable()
export class LanguageJudgeService {
  private readonly logger = LoggerService.getInstance(
    LanguageJudgeService.name,
  );

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: LanguageJudgeRepository,
    private readonly driftRepo: DriftJudgeRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `language:backfill:job:${jobId}`;
  }

  private async saveJob(job: LanguageBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      LanguageJudgeService.JOB_TTL_SECONDS,
    );
  }

  /** Start an async backfill over a window; returns a job id to poll. */
  async startBackfill(
    sinceDays = 90,
    onlyUnjudged = false,
  ): Promise<LanguageBackfillJobDto> {
    const jobId = randomUUID();
    const job: LanguageBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      errorAnnotations: 0,
      skipped: 0,
      error: null,
    };
    await this.saveJob(job);
    // Fire-and-forget: the HTTP request returns immediately with the job id.
    void this.runJob(job, sinceDays, onlyUnjudged);
    this.logger.debug(
      `language backfill queued job=${jobId} sinceDays=${sinceDays} onlyUnjudged=${onlyUnjudged}`,
    );
    return { ...job };
  }

  async getJob(jobId: string): Promise<LanguageBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as LanguageBackfillJobDto) : undefined;
  }

  private async runJob(
    job: LanguageBackfillJobDto,
    sinceDays: number,
    onlyUnjudged: boolean,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const sessions = await this.repo.selectSessions({
        sinceDays,
        onlyUnjudged,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);
      for (const s of sessions) {
        try {
          const { transcript, aiText, userText } =
            await this.driftRepo.buildTranscript(s.id);
          if (Object.keys(aiText).length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            continue;
          }
          const judged = await this.judgeViaAi(transcript, s, rubric);
          await this.repo.persistJudgment(
            s,
            judged.result,
            judged.judgeModel,
            judged.judgePromptVersion,
            aiText,
            userText,
          );
          job.judged += 1;
          job.errorAnnotations += judged.result.per_turn.reduce(
            (n, t) => n + t.errors.length,
            0,
          );
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad session must not abort the whole job.
          this.logger.error(
            `language backfill: session ${s.id} failed: ${(e as Error).message}`,
          );
          job.processed += 1;
          await this.saveJob(job);
        }
      }
      job.status = 'done';
      await this.saveJob(job);
    } catch (e) {
      this.logger.error(
        `language backfill job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /** Call ally-ai's stateless language judge over HTTP. */
  private async judgeViaAi(
    transcript: unknown[],
    s: LanguageSessionRow,
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/language-quality/judge`,
      {
        transcript,
        persona: s.persona ?? '',
        language: s.language,
        language_eval_config: {
          language_label: s.language_label ?? undefined,
          // target_variety / diglossia / code_switch_partners come from
          // languages.evalConfig (Phase 3); the judge renders absent values
          // as "unknown".
        },
        scenario_style_config: {
          register_directive_configured: s.register_directive_configured,
          style_exemplars_configured: s.style_exemplars_configured,
          allowed_fillers: s.allowed_fillers ?? [],
          engine: s.engine ?? undefined,
        },
        rubric,
      },
      {
        headers: { 'x-api-key': outboundApiKey },
        // Single Gemini call over a whole transcript — allow time.
        timeout: 120_000,
      },
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      result: LanguageJudgeAiResult;
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      result: d.result,
    };
  }
}
