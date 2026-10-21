import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  ImageGenerationJobDto,
  ImageGenerationJobStatus,
} from '../dto/image-generation-job.dto';

/** The editor buttons that generate an image as a job. */
export type ImageGenerationJobKind = 'scenario-cover' | 'course-cover';

/** Records outlive any poll by a wide margin and then clean themselves up. */
export const IMAGE_GENERATION_JOB_TTL_SECONDS = 60 * 60;

/**
 * A run still `running` after this lost its API task mid-run (a deploy
 * replaced it). Far past the slowest generation seen in production (95 s).
 */
export const IMAGE_GENERATION_JOB_STALE_SECONDS = 5 * 60;

export const IMAGE_GENERATION_FAILED_MESSAGE =
  "Couldn't generate an image this time. Try again in a moment.";

interface ImageGenerationJobRecord {
  jobId: string;
  kind: ImageGenerationJobKind;
  ownerId: number;
  status: ImageGenerationJobStatus;
  startedAt: string;
  finishedAt?: string;
  imageUrl?: string;
  error?: string;
}

/**
 * Image generation for the editor's cover buttons, run as a background job.
 *
 * gpt-image-1 regularly takes longer than the load balancer's 60 s idle
 * timeout, and a synchronous request that outlives it is cut off: the author
 * is told it failed while the server finishes and stores the image anyway
 * (three of three roleplay covers in prod on 2026-10-14, 79–95 s each). So a
 * start returns at once with a job id and the editor polls for the record —
 * the same shape as GlossaryJobService, without its per-language lock, since
 * two authors generating at once never conflict.
 *
 * Records live in Redis because the API runs as several tasks and a poll can
 * land on any of them. A record is readable only by the user who started it.
 */
@Injectable()
export class ImageGenerationJobService {
  private readonly logger = LoggerService.getInstance(
    ImageGenerationJobService.name,
  );

  constructor(private readonly redis: RedisService) {}

  async start(
    kind: ImageGenerationJobKind,
    ownerId: number,
    run: () => Promise<{ imageUrl: string }>,
  ): Promise<ImageGenerationJobDto> {
    const job: ImageGenerationJobRecord = {
      jobId: randomUUID(),
      kind,
      ownerId,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await this.save(job);
    void this.execute(job, run);
    return this.toDto(job);
  }

  /** The job, with a lost `running` job reported as failed. */
  async get(
    kind: ImageGenerationJobKind,
    ownerId: number,
    jobId: string,
  ): Promise<ImageGenerationJobDto> {
    const raw = await this.redis.get(this.key(kind, jobId));
    const job = raw ? (JSON.parse(raw) as ImageGenerationJobRecord) : null;
    if (!job || job.ownerId !== ownerId) {
      throw new NotFoundException(
        'That image request has expired. Generate a new one.',
      );
    }
    const ageSeconds = (Date.now() - Date.parse(job.startedAt)) / 1000;
    if (
      job.status === 'running' &&
      ageSeconds > IMAGE_GENERATION_JOB_STALE_SECONDS
    ) {
      return this.toDto({
        ...job,
        status: 'failed',
        error: IMAGE_GENERATION_FAILED_MESSAGE,
      });
    }
    return this.toDto(job);
  }

  private async execute(
    job: ImageGenerationJobRecord,
    run: () => Promise<{ imageUrl: string }>,
  ): Promise<void> {
    try {
      const { imageUrl } = await run();
      await this.save({
        ...job,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        imageUrl,
      });
    } catch (error) {
      this.logger.error(
        `[IMAGE_JOB] kind=${job.kind} job=${job.jobId} failed: ${
          (error as Error)?.message ?? error
        }`,
      );
      await this.save({
        ...job,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: this.toAuthorMessage(error),
      }).catch((saveError) =>
        this.logger.error(
          `[IMAGE_JOB] job=${job.jobId} could not record its failure: ${saveError}`,
        ),
      );
    }
  }

  /**
   * The generation services throw HttpExceptions worded for the author
   * ("try rewording it", "busy right now"); anything else — an S3 or Redis
   * failure — is not theirs to read, and stays in the log.
   */
  private toAuthorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown })?.message;
      if (typeof message === 'string' && message) return message;
    }
    return IMAGE_GENERATION_FAILED_MESSAGE;
  }

  private save(job: ImageGenerationJobRecord) {
    return this.redis.set(
      this.key(job.kind, job.jobId),
      JSON.stringify(job),
      IMAGE_GENERATION_JOB_TTL_SECONDS,
    );
  }

  private key(kind: ImageGenerationJobKind, jobId: string) {
    return `image-generation:${kind}:job:${jobId}`;
  }

  private toDto(job: ImageGenerationJobRecord): ImageGenerationJobDto {
    return {
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt,
      ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
      ...(job.imageUrl ? { imageUrl: job.imageUrl } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }
}
