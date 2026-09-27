import { ConflictException, NotFoundException } from '@nestjs/common';
import { GlossaryJobService } from '../glossary-job.service';

/** In-memory stand-in for RedisService: get/set plus the NX lock. */
function memoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      acquireLock: jest.fn(async (k: string) => {
        if (store.has(k)) return false;
        store.set(k, '1');
        return true;
      }),
      releaseLock: jest.fn(async (k: string) => void store.delete(k)),
    } as any,
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

describe('GlossaryJobService', () => {
  it('runs an adjudication in the background and records its verdicts', async () => {
    const { redis } = memoryRedis();
    const jobs = new GlossaryJobService(redis);
    let finish!: (v: unknown) => void;

    const job = await jobs.start(
      'adjudication',
      6,
      { apply: true },
      () => new Promise((r) => (finish = r)),
    );

    expect(job).toMatchObject({ kind: 'adjudication', status: 'running' });
    expect((await jobs.get('adjudication', 6, job.jobId)).status).toBe(
      'running',
    );
    finish({ considered: 6, accepted: 6 });
    await settle();
    const done = await jobs.get('adjudication', 6, job.jobId);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ considered: 6, accepted: 6 });
  });

  it('locks per kind and language, not globally', async () => {
    const { redis } = memoryRedis();
    const jobs = new GlossaryJobService(redis);
    const never = () => new Promise(() => undefined);

    await jobs.start('adjudication', 6, {}, never);
    await expect(jobs.start('adjudication', 6, {}, never)).rejects.toThrow(
      ConflictException,
    );
    // A mining run on the same language, or an adjudication on another one,
    // is not blocked.
    await expect(
      jobs.start('lexeme-mining', 6, {}, never),
    ).resolves.toBeDefined();
    await expect(
      jobs.start('adjudication', 2, {}, never),
    ).resolves.toBeDefined();
  });

  it('keeps kinds apart when polling', async () => {
    const { redis } = memoryRedis();
    const jobs = new GlossaryJobService(redis);
    const job = await jobs.start('adjudication', 6, {}, async () => 1);
    await expect(jobs.get('lexeme-mining', 6, job.jobId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('frees the lock when saving the job record fails', async () => {
    const { redis, store } = memoryRedis();
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    const jobs = new GlossaryJobService(redis);
    await expect(
      jobs.start('adjudication', 6, {}, async () => 1),
    ).rejects.toThrow('redis down');
    expect([...store.keys()]).toEqual([]);
  });
});
