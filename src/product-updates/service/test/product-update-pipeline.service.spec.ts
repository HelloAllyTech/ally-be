import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import { ProductUpdateSourceRepository } from '../../repository/product-update-source.repository';
import { ProductUpdateConsolidationService } from '../product-update-consolidation.service';
import { ProductUpdateIngestService } from '../product-update-ingest.service';
import { ProductUpdateLivenessService } from '../product-update-liveness.service';
import { ProductUpdatePipelineService } from '../product-update-pipeline.service';

describe('ProductUpdatePipelineService', () => {
  let counts: Record<string, number>;
  let ingest: { ingestJournal: jest.Mock; enrichPending: jest.Mock };
  let consolidation: { consolidateBatch: jest.Mock };
  let liveness: { refresh: jest.Mock };
  let redis: {
    acquireLock: jest.Mock;
    releaseLock: jest.Mock;
    set: jest.Mock;
    get: jest.Mock;
  };
  let config: { productUpdates: { enabled: boolean } };
  let service: ProductUpdatePipelineService;

  beforeEach(() => {
    counts = { pending: 0, enriched: 0, consolidated: 40, noise: 10 };
    ingest = {
      ingestJournal: jest.fn().mockResolvedValue({ added: 3, skipped: 0 }),
      enrichPending: jest.fn().mockResolvedValue({ enriched: 3, degraded: 0 }),
    };
    consolidation = {
      consolidateBatch: jest
        .fn()
        .mockResolvedValueOnce({ done: false, error: null, clusters: 2 })
        .mockResolvedValue({ done: true, error: null }),
    };
    liveness = { refresh: jest.fn().mockResolvedValue({ updatesLive: 1 }) };
    redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
    };
    config = { productUpdates: { enabled: true } };
    service = new ProductUpdatePipelineService(
      {
        countByStatus: jest.fn(async () => counts),
      } as unknown as ProductUpdateSourceRepository,
      ingest as unknown as ProductUpdateIngestService,
      consolidation as unknown as ProductUpdateConsolidationService,
      liveness as unknown as ProductUpdateLivenessService,
      redis as unknown as RedisService,
      config as unknown as AppConfigService,
    );
  });

  it('does nothing on the schedule while the feature is switched off', async () => {
    config.productUpdates.enabled = false;

    expect(await service.run('scheduled')).toBeNull();
    expect(ingest.ingestJournal).not.toHaveBeenCalled();
  });

  it('does not start a second pass while one holds the lock', async () => {
    redis.acquireLock.mockResolvedValue(false);

    expect(await service.run('manual')).toBeNull();
    expect(ingest.ingestJournal).not.toHaveBeenCalled();
  });

  it('runs a scheduled-size pass, stops when nothing waits, records it and releases the lock', async () => {
    const result = await service.run('scheduled');

    expect(ingest.enrichPending).toHaveBeenCalledWith(80);
    expect(consolidation.consolidateBatch).toHaveBeenCalledTimes(2);
    expect(result?.batches).toHaveLength(1);
    expect(liveness.refresh).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      'product-updates:last-run',
      expect.stringContaining('"trigger":"scheduled"'),
    );
    expect(redis.releaseLock).toHaveBeenCalledWith('product-updates:pipeline');
  });

  it('catches up the whole journal on the first pass after switching on', async () => {
    counts = { pending: 0, enriched: 0, consolidated: 0, noise: 0 };

    await service.run('scheduled');

    expect(ingest.enrichPending).toHaveBeenCalledWith(5000);
  });

  it('catches up with backfill limits when a large backlog builds up', async () => {
    counts = { pending: 400, enriched: 50, consolidated: 40, noise: 10 };

    await service.run('scheduled');

    expect(ingest.enrichPending).toHaveBeenCalledWith(5000);
  });

  it('records a failure and still releases the lock', async () => {
    ingest.ingestJournal.mockRejectedValue(new Error('GitHub unreachable'));

    const result = await service.run('manual');

    expect(result?.error).toBe('GitHub unreachable');
    expect(redis.releaseLock).toHaveBeenCalled();
  });
});
