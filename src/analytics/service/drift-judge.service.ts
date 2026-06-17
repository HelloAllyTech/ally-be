import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
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
 * Owns conversation-drift judging end to end. ally-be owns the session data, so
 * it selects which sessions to judge, builds each transcript, calls ally-ai's
 * stateless judge over HTTP, and persists the per-turn rows itself — ally-ai
 * never touches this database.
 *
 * Backfill runs as an in-memory background job (the Gemini judge is slow and a
 * 3-month run is long). Single-instance only; a multi-replica deploy should
 * move job state to a table — same caveat the old ally-ai version carried.
 */
@Injectable()
export class DriftJudgeService {
  private readonly logger = LoggerService.getInstance(DriftJudgeService.name);
  private readonly jobs = new Map<string, DriftBackfillJobDto>();

  constructor(
    private readonly repo: DriftJudgeRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Start an async backfill over a window; returns a job id to poll. */
  startBackfill(sinceDays = 90, onlyUnjudged = false): DriftBackfillJobDto {
    const jobId = randomUUID();
    const job: DriftBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      drifted: 0,
      skipped: 0,
      error: null,
    };
    this.jobs.set(jobId, job);
    // Fire-and-forget: the HTTP request returns immediately with the job id.
    void this.runJob(job, sinceDays, onlyUnjudged);
    this.logger.debug(
      `drift backfill queued job=${jobId} sinceDays=${sinceDays} onlyUnjudged=${onlyUnjudged}`,
    );
    return { ...job };
  }

  getJob(jobId: string): DriftBackfillJobDto | undefined {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  private async runJob(
    job: DriftBackfillJobDto,
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
      for (const s of sessions) {
        try {
          const { transcript, aiText, userText } =
            await this.repo.buildTranscript(s.id);
          if (Object.keys(aiText).length === 0) {
            job.skipped += 1;
            job.processed += 1;
            continue;
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
        } catch (e) {
          // One bad session must not abort the whole job.
          this.logger.error(
            `drift backfill: session ${s.id} failed: ${(e as Error).message}`,
          );
          job.processed += 1;
        }
      }
      job.status = 'done';
    } catch (e) {
      this.logger.error(
        `drift backfill job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
    }
  }

  /** Call ally-ai's stateless judge over HTTP. */
  private async judgeViaAi(
    transcript: TranscriptTurn[],
    persona: string,
    language: string,
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/drift/judge`,
      { transcript, persona, language, rubric },
      {
        headers: { 'x-api-key': outboundApiKey },
        // The judge is a single Gemini call over a whole transcript — allow time.
        timeout: 120_000,
      },
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
