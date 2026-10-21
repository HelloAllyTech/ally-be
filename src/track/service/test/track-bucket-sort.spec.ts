import { BadRequestException } from '@nestjs/common';
import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackBucketSortService } from '../track-bucket-sort.service';
import { sanitizeBucketSortForLearner } from '../track-bucket-sort.sanitizer';
import { validateBucketSortContent } from '../track-structure.validator';
import { TrackItemType } from '../../type/track.type';
import { BucketSortContent } from '../../type/bucket-sort.type';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({ error: jest.fn(), info: jest.fn() })),
  },
}));

const content = (): BucketSortContent => ({
  buckets: [
    { id: 'b1', label: 'Helps' },
    { id: 'b2', label: 'Harms' },
  ],
  items: [
    {
      id: 'i1',
      text: 'Reflect feelings',
      bucketId: 'b1',
      explanation: 'Why 1',
    },
    { id: 'i2', text: 'Give advice fast', bucketId: 'b2' },
  ],
});

describe('validateBucketSortContent', () => {
  it('accepts a well-formed sort', () => {
    expect(() => validateBucketSortContent(content(), 'T')).not.toThrow();
  });
  it('rejects an item pointing at a missing bucket', () => {
    const c = content();
    c.items[0].bucketId = 'nope';
    expect(() => validateBucketSortContent(c, 'T')).toThrow(
      BadRequestException,
    );
  });
  it('rejects a bucket nothing belongs in', () => {
    const c = content();
    c.items[1].bucketId = 'b1';
    expect(() => validateBucketSortContent(c, 'T')).toThrow(/no item belongs/);
  });
  it('rejects duplicate bucket names', () => {
    const c = content();
    c.buckets[1].label = ' helps ';
    expect(() => validateBucketSortContent(c, 'T')).toThrow(/both called/);
  });
});

describe('sanitizeBucketSortForLearner', () => {
  it('strips the key from unplaced items and is stable per seed', () => {
    const a = sanitizeBucketSortForLearner(content(), undefined, 's');
    const b = sanitizeBucketSortForLearner(content(), undefined, 's');
    expect(JSON.stringify(a)).not.toContain('Why 1');
    expect(JSON.stringify(a.items)).not.toContain('bucketId');
    expect(a.items).toEqual(b.items);
    expect(a.answered).toEqual({});
  });
  it('reveals the key only for placed items', () => {
    const out = sanitizeBucketSortForLearner(
      content(),
      { i1: { bucketId: 'b2', correct: false } },
      's',
    );
    expect(out.answered.i1).toEqual({
      correct: false,
      placedBucketId: 'b2',
      correctBucketId: 'b1',
      explanation: 'Why 1',
    });
    expect(out.answered.i2).toBeUndefined();
  });
});

describe('TrackBucketSortService', () => {
  const setup = (meta: any = {}, status = SessionItemStatus.UNLOCKED) => {
    const progress = { id: 'p1', status, meta };
    const repo = { update: jest.fn() };
    const progressService = {
      completeItem: jest.fn().mockResolvedValue({ ok: 1 }),
    };
    const enrollment = {
      getPermittedItemProgress: jest.fn().mockResolvedValue({
        item: { type: TrackItemType.BUCKET_SORT, content: content() },
        progress,
      }),
    };
    const service = new TrackBucketSortService(
      repo as any,
      enrollment as any,
      progressService as any,
    );
    return { service, repo, progressService };
  };

  it('returns the verdict and records the first placement', async () => {
    const { service, repo, progressService } = setup();
    const res = await service.checkPlacement('x', 'i1', 'b2');
    expect(res).toMatchObject({
      correct: false,
      correctBucketId: 'b1',
      explanation: 'Why 1',
      finished: false,
    });
    expect(repo.update.mock.calls[0][1].meta.bucketSortAnswers.i1).toEqual({
      bucketId: 'b2',
      correct: false,
    });
    expect(progressService.completeItem).not.toHaveBeenCalled();
  });

  it('does not let a wrong first guess be replaced', async () => {
    const { service, repo } = setup({
      bucketSortAnswers: { i1: { bucketId: 'b2', correct: false } },
    });
    const res = await service.checkPlacement('x', 'i1', 'b1');
    expect(res.correct).toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('completes when the last item is placed, whatever the score', async () => {
    const { service, repo, progressService } = setup({
      bucketSortAnswers: { i1: { bucketId: 'b2', correct: false } },
    });
    const res = await service.checkPlacement('x', 'i2', 'b2');
    expect(res).toMatchObject({ finished: true, firstTryPct: 50 });
    expect(repo.update.mock.calls[0][1].meta).toMatchObject({
      bucketSortBestFirstTryPct: 50,
      bucketSortRounds: 1,
    });
    expect(progressService.completeItem).toHaveBeenCalledWith('p1', {});
  });

  it('rejects unknown ids and mid-round restarts', async () => {
    const { service } = setup();
    await expect(service.checkPlacement('x', 'zz', 'b1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.checkPlacement('x', 'i1', 'zz')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.startNewRound('x')).rejects.toThrow(
      BadRequestException,
    );
  });
});
