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
import { LanguageBackfillJobDto } from '../dto/platform-analytics.dto';
import { VarietyProfileService } from 'src/language/service/variety-profile.service';
import { DriftJudgeRepository } from '../repository/drift-judge.repository';
import {
  computeScriptFidelityPct,
  scriptForLanguage,
} from '../util/script-fidelity.util';
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
/**
 * How many WER top-ups run at once.
 *
 * Lower than the judging pool on purpose: each one fans out over its sampled
 * utterances inside ally-ai, so this number multiplies there against a speech
 * vendor's rate limit rather than against our own LLM ceiling.
 */
const ROUND_TRIP_CONCURRENCY = 3;

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
    private readonly varietyProfileService: VarietyProfileService,
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
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
    /**
     * Cap on how many sessions this run takes on.
     *
     * The drainer passes a chunk size so a run finishes well inside one tick.
     * That is what makes a restart cheap: the selector already skips anything
     * already judged, so an interrupted chunk costs only the sessions in
     * flight, and the next tick simply picks up the next batch.
     */
    limit?: number | null,
  ): Promise<LanguageBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const jobId = randomUUID();
    const job: LanguageBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      errorAnnotations: 0,
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
      limit ?? null,
    );
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
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    concurrency: number,
    limit: number | null,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const sessions = await this.repo.selectSessions({
        sinceDays,
        onlyUnjudged,
        unjudgedForVersion,
        limit,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);
      // Independent per session, so run a bounded pool rather than one at a
      // time — the LLM call dominates each iteration.
      await runWithConcurrency(sessions, concurrency, async (s) => {
        try {
          const { transcript, aiText, userText } =
            await this.driftRepo.buildTranscript(s.id);
          if (Object.keys(aiText).length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }
          const judged = await this.judgeViaAi(transcript, s, rubric);
          // Objective metrics (FR2). Script fidelity is pure code; round-trip
          // WER is a best-effort ally-ai call — a failure degrades to null
          // (shown as unmeasured), never blocks the judgment.
          const scriptFidelityPct = computeScriptFidelityPct(
            Object.values(aiText),
            scriptForLanguage(s.language, s.eval_config?.script),
          );
          // Round-trip WER is deliberately NOT awaited here. It is a TTS+ASR
          // round trip against a vendor — the slowest thing in this loop and
          // the only one whose failure is already tolerated. Blocking a worker
          // on it cost 180s per timeout on 37% of sessions, which is throughput
          // spent on a field that renders as "not measured" either way. It is
          // filled in afterwards by `topUpRoundTripWer`, so a judgment is never
          // held up by it and a restart mid-way loses nothing.
          await this.repo.persistJudgment(
            s,
            judged.result,
            judged.judgeModel,
            judged.judgePromptVersion,
            aiText,
            userText,
            { scriptFidelityPct, roundTripWerPct: null },
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
          job.failed += 1;
          job.processed += 1;
          await this.saveJob(job);
        }
      });
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
    // Population-aware variety (RSI loop): when the session's tenant is
    // attached to a variety profile, the judge scores against that
    // population's measured variety instead of the language-wide default.
    // Best-effort — a profile lookup failure never blocks judging.
    const varietyOverride = await this.varietyProfileService
      .resolveVarietyOverride(s.language, s.tenant_id)
      .catch(() => null);
    // Held inside the GLOBAL judge slot: the ceiling has to span every
    // backfill at once, not just this job's own pool.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/language-quality/judge`,
        {
          transcript,
          persona: s.persona ?? '',
          language: s.language,
          // FR19: per-language declarative config from languages.evalConfig;
          // the judge renders absent values as "unknown".
          language_eval_config: {
            language_label: s.language_label ?? undefined,
            target_variety:
              varietyOverride ?? s.eval_config?.targetVariety ?? undefined,
            diglossia: s.eval_config?.diglossia ?? undefined,
            code_switch_partners: s.eval_config?.codeSwitchPartners ?? [],
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
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
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

  /** How many of a session's AI turns to round-trip (longest first). */
  private static readonly ROUND_TRIP_SAMPLE = 5;

  /**
   * Fill in round-trip WER for judgments that went out without it.
   *
   * Split out of the judging loop because it is the one measurement here that
   * talks to a speech vendor: a TTS call plus an ASR call per sampled
   * utterance, and its failure is already defined as "not measured". Leaving it
   * inline meant a judgment nobody was waiting on held a worker for three
   * minutes.
   *
   * Bounded per call and safe to interrupt: it only ever selects rows that are
   * still NULL, so a run that dies half way is simply a shorter run. Sessions
   * whose WER genuinely cannot be measured stay NULL and are retried on later
   * passes — cheap, because the selector is indexed and the backlog shrinks as
   * the measurable ones fill in.
   */
  async topUpRoundTripWer(
    pin: { judgeModel: string; judgePromptVersion: string },
    limit: number,
  ): Promise<{ attempted: number; measured: number }> {
    const rows = await this.repo.selectJudgmentsMissingRoundTrip(pin, limit);
    let measured = 0;

    await runWithConcurrency(rows, ROUND_TRIP_CONCURRENCY, async (row) => {
      const { aiText } = await this.driftRepo.buildTranscript(row.session.id);
      if (Object.keys(aiText).length === 0) return;
      const pct = await this.roundTripViaAi(row.session, aiText);
      if (pct === null) return;
      await this.repo.updateRoundTripWer(row.judgmentId, pct);
      measured += 1;
    });

    return { attempted: rows.length, measured };
  }

  /**
   * Round-trip WER via ally-ai (PRD FR2): re-synthesize a sample of the
   * session's own AI turns with the session's TTS provider (or a language
   * fallback), transcribe them back, average the error. Best-effort: any
   * failure returns null (rendered as "not yet measured", never as 0).
   */
  private async roundTripViaAi(
    s: LanguageSessionRow,
    aiText: Record<number, string>,
  ): Promise<number | null> {
    try {
      const utterances = Object.entries(aiText)
        .map(([turnIndex, text]) => ({
          turn_index: Number(turnIndex),
          text: (text ?? '').trim(),
        }))
        .filter((u) => u.text.length > 0)
        .sort((a, b) => b.text.length - a.text.length)
        .slice(0, LanguageJudgeService.ROUND_TRIP_SAMPLE);
      if (utterances.length === 0) return null;

      const { apiUrl, outboundApiKey } = this.config.ai;
      const res = await axios.post(
        `${apiUrl}/api/v1/round-trip-wer/`,
        {
          utterances,
          language: s.language,
          tts_provider: s.tts_provider ?? undefined,
          unit: s.eval_config?.errorRateUnit === 'cer' ? 'cer' : 'wer',
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          // Up to 5 utterances × (TTS + ASR) round trips.
          timeout: 180_000,
        },
      );
      const avg = (res.data as { avg_error_pct: number | null }).avg_error_pct;
      return avg == null ? null : Number(avg);
    } catch (e) {
      this.logger.warn(
        `round-trip WER unavailable for session ${s.id}: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
