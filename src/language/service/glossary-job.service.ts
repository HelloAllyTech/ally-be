import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from 'src/redis/service/redis.service';
import {
  GLOSSARY_JOB_STALE_SECONDS,
  GLOSSARY_JOB_TTL_SECONDS,
} from '../constants/glossary.constants';

/** The glossary operations that run as background jobs. */
export type GlossaryJobKind = 'lexeme-mining' | 'adjudication';

export type GlossaryJobStatus = 'running' | 'succeeded' | 'failed';

export interface GlossaryJob<R = unknown, O = unknown> {
  jobId: string;
  kind: GlossaryJobKind;
  languageId: number;
  status: GlossaryJobStatus;
  options: O;
  startedAt: string;
  finishedAt?: string;
  result?: R;
  error?: string;
}

/**
 * Background jobs for glossary operations that call a thinking model and so
 * outlive the load balancer's 60 s idle timeout — lexeme mining (45-60 s) and
 * adjudication (past 60 s on Tamil). A request starts the job and returns at
 * once; the client polls for the record.
 *
 * Records live in Redis, not memory: the API runs as several tasks and a poll
 * can land on any of them. One job per (kind, language) at a time, enforced
 * with a Redis lock — two concurrent write runs would each decide against a
 * glossary that lacks the other's changes. A job still `running` after
 * GLOSSARY_JOB_STALE_SECONDS lost its task mid-run (a deploy replaced it) and
 * is reported as failed; the lock expires at the same bound, so a lost run
 * never blocks the next one for longer.
 */
@Injectable()
export class GlossaryJobService {
  private readonly logger = new Logger(GlossaryJobService.name);

  constructor(private readonly redis: RedisService) {}

  async start<R, O>(
    kind: GlossaryJobKind,
    languageId: number,
    options: O,
    run: () => Promise<R>,
  ): Promise<GlossaryJob<R, O>> {
    const job = await this.open<R, O>(kind, languageId, options);
    void this.execute(job, run);
    return job;
  }

  /**
   * Run a job to completion under the same lock and record as `start` — for
   * unattended callers (the weekly scheduler) that must neither overlap a
   * manual run nor fire every language at once. Returns null, without
   * running, when a run of this kind already holds the language.
   */
  async runExclusive<R, O>(
    kind: GlossaryJobKind,
    languageId: number,
    options: O,
    run: () => Promise<R>,
  ): Promise<GlossaryJob<R, O> | null> {
    let job: GlossaryJob<R, O>;
    try {
      job = await this.open<R, O>(kind, languageId, options);
    } catch (error) {
      if (error instanceof ConflictException) return null;
      throw error;
    }
    await this.execute(job, run);
    return this.get<R, O>(kind, languageId, job.jobId);
  }

  /** Take the (kind, language) lock and write the `running` record. */
  private async open<R, O>(
    kind: GlossaryJobKind,
    languageId: number,
    options: O,
  ): Promise<GlossaryJob<R, O>> {
    const lockKey = this.lockKey(kind, languageId);
    if (!(await this.redis.acquireLock(lockKey, GLOSSARY_JOB_STALE_SECONDS))) {
      throw new ConflictException(
        `A glossary ${kind} run is already in progress for this language`,
      );
    }
    const job: GlossaryJob<R, O> = {
      jobId: randomUUID(),
      kind,
      languageId,
      status: 'running',
      options,
      startedAt: new Date().toISOString(),
    };
    try {
      await this.save(job);
    } catch (error) {
      await this.redis.releaseLock(lockKey).catch(() => undefined);
      throw error;
    }
    return job;
  }

  /** The job record, with a lost `running` job reported as failed. */
  async get<R = unknown, O = unknown>(
    kind: GlossaryJobKind,
    languageId: number,
    jobId: string,
  ): Promise<GlossaryJob<R, O>> {
    const raw = await this.redis.get(this.jobKey(kind, jobId));
    const job = raw ? (JSON.parse(raw) as GlossaryJob<R, O>) : null;
    if (!job || job.languageId !== languageId) {
      throw new NotFoundException(
        `Glossary ${kind} job ${jobId} not found for language ${languageId} (records expire after 24 h)`,
      );
    }
    const ageSeconds = (Date.now() - Date.parse(job.startedAt)) / 1000;
    if (job.status === 'running' && ageSeconds > GLOSSARY_JOB_STALE_SECONDS) {
      return {
        ...job,
        status: 'failed',
        error:
          'The run did not finish — its API task most likely restarted mid-run. Start a new one.',
      };
    }
    return job;
  }

  private async execute<R, O>(
    job: GlossaryJob<R, O>,
    run: () => Promise<R>,
  ): Promise<void> {
    try {
      const result = await run();
      await this.save({
        ...job,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[GLOSSARY_JOB] kind=${job.kind} job=${job.jobId} language=${job.languageId} failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.save({
        ...job,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: message,
      }).catch((saveError) =>
        this.logger.error(
          `[GLOSSARY_JOB] job=${job.jobId} could not record its failure: ${saveError}`,
        ),
      );
    } finally {
      await this.redis
        .releaseLock(this.lockKey(job.kind, job.languageId))
        .catch(() => undefined);
    }
  }

  private save(job: GlossaryJob<unknown, unknown>) {
    return this.redis.set(
      this.jobKey(job.kind, job.jobId),
      JSON.stringify(job),
      GLOSSARY_JOB_TTL_SECONDS,
    );
  }

  private jobKey(kind: GlossaryJobKind, jobId: string) {
    return `glossary:${kind}:job:${jobId}`;
  }

  private lockKey(kind: GlossaryJobKind, languageId: number) {
    return `glossary:${kind}:lock:${languageId}`;
  }
}
