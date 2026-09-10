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
import { RagQualityBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  RagPassage,
  RagPassageJudgment,
  RagQualityRepository,
  RagRetrievalJudgment,
  RagRetrievalRow,
} from '../repository/rag-quality.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  passages: RagPassageJudgment[];
  retrieval: RagRetrievalJudgment | null;
}

/**
 * Max candidate passages sent for one retrieval, highest-ranked first.
 *
 * Not a quality limit — a cost one. A two-pass retrieval can record forty candidates and a
 * character-corpus chunk is 800 tokens, so judging every candidate of every retrieval is a
 * 30k-token call per row over a backlog. Twelve covers everything that reached the consumer
 * (the limit is 8) plus the first few discards, which is where the shaping rules are actually
 * in question. The rest of the discards ranked below passages already labelled, so their
 * marginal information is the smallest in the row.
 */
const MAX_JUDGED_PASSAGES = 12;

/**
 * Judges whether retrieval actually answered the query, and writes the labels the retrieval
 * log was built to be joined against.
 *
 * `kb_retrievals` records what came back and at what similarity; a similarity is not a measure
 * of usefulness, and in production it demonstrably was not one — the character corpus returned
 * nothing for "how specific should a character be" against a document whose section was titled
 * "Specific beats representative, every time". This supplies the missing half: a relevance
 * label per passage, and a sufficiency verdict per retrieval.
 *
 * Same division as the other four judge families: ally-be selects, assembles and persists;
 * ally-ai is stateless and never touches this database. Job state lives in Redis because
 * ally-be is load-balanced, so the call that starts a run and the one that polls it can land on
 * different instances.
 *
 * Cheaper than the roleplay judges per row (one call over a query and a handful of passages,
 * not a whole transcript) and far more numerous, which is why the drainer takes it in bounded
 * chunks like the rest and why it holds the GLOBAL judge slot: the ceiling has to span every
 * family at once, since core-ai has been taken down by exactly this kind of fan-out before.
 */
@Injectable()
export class RagQualityJudgeService {
  private readonly logger = LoggerService.getInstance(
    RagQualityJudgeService.name,
  );

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: RagQualityRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  private jobKey(jobId: string): string {
    return `rag-quality:backfill:job:${jobId}`;
  }

  private async saveJob(job: RagQualityBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      RagQualityJudgeService.JOB_TTL_SECONDS,
    );
  }

  async getJob(jobId: string): Promise<RagQualityBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as RagQualityBackfillJobDto) : undefined;
  }

  /** Start an async run over a window; returns a job id to poll. */
  async startBackfill(
    sinceDays = 30,
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
    limit?: number | null,
  ): Promise<RagQualityBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const jobId = randomUUID();
    const job: RagQualityBackfillJobDto = {
      jobId,
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      skipped: 0,
      passagesJudged: 0,
      passagesUnhelpful: 0,
      retrievalsUnhelpful: 0,
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
      `rag-quality backfill queued job=${jobId} sinceDays=${sinceDays} ` +
        `version=${unjudgedForVersion?.judgePromptVersion ?? 'any'}`,
    );
    return { ...job };
  }

  /**
   * Select a BALANCED batch across consumers rather than the newest rows outright.
   *
   * The admin retrieval preview and the interview agent are different populations, and the
   * preview's is the one an operator can generate hundreds of on a single afternoon of
   * threshold-probing. Taken newest-first, that afternoon becomes the entire measurement, and
   * the number it produces describes the operator rather than the corpus. Splitting the chunk
   * between consumers keeps the agent's traffic in every batch — sampling across the variation
   * that exists is the cheapest guard against reading one population as another (Stacks:
   * "Mitigate false negatives by recruiting participant variation").
   *
   * A consumer with nothing eligible simply contributes nothing; its share is not redistributed,
   * because a batch that silently becomes single-consumer again is the thing being avoided.
   */
  private async selectBalanced(
    sinceDays: number,
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    limit: number | null,
  ): Promise<RagRetrievalRow[]> {
    if (!limit) {
      return this.repo.selectRetrievals({ sinceDays, unjudgedForVersion });
    }
    const consumers = ['interview_agent', 'admin_preview'];
    const share = Math.max(1, Math.floor(limit / consumers.length));
    const batches = await Promise.all(
      consumers.map((consumer) =>
        this.repo.selectRetrievals({
          sinceDays,
          unjudgedForVersion,
          consumer,
          limit: share,
        }),
      ),
    );
    return batches.flat();
  }

  private async runJob(
    job: RagQualityBackfillJobDto,
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
      const retrievals = await this.selectBalanced(
        sinceDays,
        unjudgedForVersion,
        limit,
      );
      job.status = 'running';
      job.total = retrievals.length;
      await this.saveJob(job);

      await runWithConcurrency(retrievals, concurrency, async (r) => {
        try {
          const { passages, recorded } = await this.repo.buildPassages(
            r.id,
            MAX_JUDGED_PASSAGES,
          );

          // A retrieval whose candidates outlived their chunk text: a re-chunk deleted the
          // generation this retrieval read from. Skipped, not judged on the remainder — a
          // partial passage list would be labelled as though the missing passages were never
          // retrieved, which reads as a retrieval that found less than it did. A retrieval
          // that genuinely returned nothing has no passage rows at all, and IS judged: that
          // row is the whole reason for the sufficiency verdict.
          if (recorded > 0 && passages.length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const judged = await this.judgeViaAi(r, passages, rubric);

          // No verdict means OUR call failed to produce one, which is not the same as the
          // judge finding nothing useful. Writing `nothing_useful` here would blame the
          // corpus for our outage, and it would do so in the column the corpus is read by.
          if (!judged.retrieval) {
            job.failed += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const labelled = await this.repo.upsertJudgments(
            r,
            passages,
            judged.passages,
            judged.retrieval,
            judged.judgeModel,
            judged.judgePromptVersion,
          );

          job.judged += 1;
          job.passagesJudged += labelled;
          job.passagesUnhelpful += judged.passages.filter(
            (p) => p.relevance !== 'relevant',
          ).length;
          if (judged.retrieval.sufficiency === 'nothing_useful') {
            job.retrievalsUnhelpful += 1;
          }
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad retrieval must not abort a run over thousands.
          this.logger.error(
            `rag-quality backfill: retrieval ${r.id} failed: ${
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
        `rag-quality backfill job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /** Call ally-ai's stateless RAG-quality judge over HTTP. */
  private async judgeViaAi(
    retrieval: RagRetrievalRow,
    passages: RagPassage[],
    rubric: string | null,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/rag-quality/judge`,
        {
          query: retrieval.query,
          corpus: retrieval.corpus,
          min_similarity: retrieval.min_similarity,
          rubric,
          passages: passages.map((p) => ({
            chunk_id: p.chunk_id,
            document_title: p.document_title,
            section_path: p.section_path,
            similarity: p.similarity,
            text: p.text,
          })),
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
      passages: RagPassageJudgment[];
      retrieval: RagRetrievalJudgment | null;
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      passages: d.passages ?? [],
      retrieval: d.retrieval ?? null,
    };
  }
}
