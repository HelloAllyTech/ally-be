import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  IMAGE_GENERATION_FAILED_MESSAGE,
  IMAGE_GENERATION_JOB_STALE_SECONDS,
  IMAGE_GENERATION_JOB_TTL_SECONDS,
  ImageGenerationJobService,
} from '../image-generation-job.service';

jest.mock('src/logger/logger.service');

/** In-memory stand-in for the two RedisService calls the service makes. */
const fakeRedis = () => {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
  };
};

/** Let the fire-and-forget execute() settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ImageGenerationJobService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: ImageGenerationJobService;

  beforeEach(() => {
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
    });
    redis = fakeRedis();
    service = new ImageGenerationJobService(redis as unknown as RedisService);
  });

  it('returns a running job at once, before the generation finishes', async () => {
    let finish!: (value: { imageUrl: string }) => void;
    const run = () => new Promise<{ imageUrl: string }>((r) => (finish = r));

    const started = await service.start('course-cover', 7, run);

    expect(started.status).toBe('running');
    expect(started.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(redis.set).toHaveBeenCalledWith(
      `image-generation:course-cover:job:${started.jobId}`,
      expect.any(String),
      IMAGE_GENERATION_JOB_TTL_SECONDS,
    );
    expect((await service.get('course-cover', 7, started.jobId)).status).toBe(
      'running',
    );

    finish({ imageUrl: 'https://cdn/x.png' });
    await flush();

    const done = await service.get('course-cover', 7, started.jobId);
    expect(done.status).toBe('succeeded');
    expect(done.imageUrl).toBe('https://cdn/x.png');
    expect(done.finishedAt).toBeDefined();
  });

  it("passes on the generation service's own wording when it fails", async () => {
    const { jobId } = await service.start('scenario-cover', 7, async () => {
      throw new BadRequestException('Try rewording the prompt.');
    });
    await flush();

    const job = await service.get('scenario-cover', 7, jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('Try rewording the prompt.');
    expect(job.imageUrl).toBeUndefined();
  });

  it('keeps provider-busy wording too', async () => {
    const { jobId } = await service.start('course-cover', 7, async () => {
      throw new BadGatewayException('Image generation is busy right now.');
    });
    await flush();
    expect((await service.get('course-cover', 7, jobId)).error).toBe(
      'Image generation is busy right now.',
    );
  });

  it('hides an unexpected internal error behind a generic sentence', async () => {
    const { jobId } = await service.start('course-cover', 7, async () => {
      throw new Error('S3 PutObject AccessDenied arn:aws:s3:::bucket');
    });
    await flush();

    const job = await service.get('course-cover', 7, jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe(IMAGE_GENERATION_FAILED_MESSAGE);
  });

  it("is invisible to anyone but the user who started it, and to the other button's kind", async () => {
    const { jobId } = await service.start('course-cover', 7, async () => ({
      imageUrl: 'https://cdn/x.png',
    }));
    await flush();

    await expect(service.get('course-cover', 8, jobId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.get('scenario-cover', 7, jobId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.get('course-cover', 7, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a run its task lost (still running past the stale bound) as failed', async () => {
    const { jobId } = await service.start(
      'course-cover',
      7,
      () => new Promise(() => undefined),
    );
    const key = `image-generation:course-cover:job:${jobId}`;
    const record = JSON.parse(redis.store.get(key)!);
    record.startedAt = new Date(
      Date.now() - (IMAGE_GENERATION_JOB_STALE_SECONDS + 1) * 1000,
    ).toISOString();
    redis.store.set(key, JSON.stringify(record));

    const job = await service.get('course-cover', 7, jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe(IMAGE_GENERATION_FAILED_MESSAGE);
  });

  it('never exposes the owner id in what it returns', async () => {
    const started = await service.start('course-cover', 7, async () => ({
      imageUrl: 'https://cdn/x.png',
    }));
    expect(Object.keys(started)).not.toContain('ownerId');
    expect(Object.keys(started)).not.toContain('kind');
  });
});
