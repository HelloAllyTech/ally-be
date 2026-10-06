import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { FHS_SKILL_KEYS } from '../constants/helping-skills-rubric.constants';
import { HumanRatingCandidateRow } from '../repository/fhs-human-rating.repository';
import { FhsHumanRatingService } from '../service/fhs-human-rating.service';

const RATER = 7;

const allSkills = (
  verbal: { opportunity: boolean; observed?: string[] } = {
    opportunity: true,
    observed: ['verbal.b1', 'verbal.b2'],
  },
) =>
  FHS_SKILL_KEYS.map((skill) =>
    skill === 'verbal' ? { skill, ...verbal } : { skill, opportunity: false },
  );

const candidate = (i: number, userId = 100): HumanRatingCandidateRow => ({
  cutId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  userId,
  closedAt: new Date('2026-08-01T10:00:00Z'),
  compositeScore: 1 + (i % 25) / 10,
  language: i % 3 === 0 ? 'hi' : 'en',
  sessionIds: [`s${i}`],
  startSessionId: `s${i}`,
  startMessageId: i * 10,
  endSessionId: `s${i}`,
  endMessageId: i * 10 + 9,
  startsMidSession: false,
  endsMidSession: true,
});

const build = () => {
  const repository = {
    getQuarterCandidates: jest.fn().mockResolvedValue([]),
    getRatingCounts: jest.fn().mockResolvedValue(new Map()),
    getCutForRating: jest.fn().mockResolvedValue({
      cutId: 'c1',
      userId: 100,
      judgeScored: true,
    }),
    upsertRating: jest.fn().mockResolvedValue({
      id: 'r1',
      ratedAt: new Date('2026-10-05T12:00:00Z'),
      created: true,
    }),
  };
  return {
    repository,
    service: new FhsHumanRatingService(repository as any),
  };
};

describe('FhsHumanRatingService.submit', () => {
  it('stores codes with server-derived levels under the pinned version, rater = caller', async () => {
    const { repository, service } = build();
    const out = await service.submit(RATER, {
      cutId: 'c1',
      ticks: allSkills(),
    });
    expect(repository.getCutForRating).toHaveBeenCalledWith(
      'c1',
      'fhs-text-v1',
    );
    const write = repository.upsertRating.mock.calls[0][0];
    expect(write).toMatchObject({
      cutId: 'c1',
      raterId: RATER,
      rubricVersion: 'fhs-text-v1',
      anyUnhelpful: false,
    });
    expect(write.ticks).toHaveLength(FHS_SKILL_KEYS.length);
    expect(write.ticks[0]).toEqual({
      skill: 'verbal',
      opportunity: true,
      level: 3,
      observed: ['verbal.b1', 'verbal.b2'],
      notApplicable: [],
    });
    expect(out).toMatchObject({
      id: 'r1',
      cutId: 'c1',
      created: true,
      anyUnhelpful: false,
      ratedAt: '2026-10-05T12:00:00.000Z',
    });
  });

  it('upserts: a second submission by the same rater replaces theirs (created false)', async () => {
    const { repository, service } = build();
    repository.upsertRating.mockResolvedValueOnce({
      id: 'r1',
      ratedAt: new Date('2026-10-06T12:00:00Z'),
      created: false,
    });
    const out = await service.submit(RATER, {
      cutId: 'c1',
      ticks: allSkills({ opportunity: true, observed: ['verbal.u2'] }),
    });
    expect(out.created).toBe(false);
    expect(out.anyUnhelpful).toBe(true);
    expect(out.ticks[0].level).toBe(1);
  });

  it('404s an unknown cut', async () => {
    const { repository, service } = build();
    repository.getCutForRating.mockResolvedValueOnce(null);
    await expect(
      service.submit(RATER, { cutId: 'nope', ticks: allSkills() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.upsertRating).not.toHaveBeenCalled();
  });

  it('refuses a cut the judge has not scored under the current version', async () => {
    const { repository, service } = build();
    repository.getCutForRating.mockResolvedValueOnce({
      cutId: 'c1',
      userId: 100,
      judgeScored: false,
    });
    await expect(
      service.submit(RATER, { cutId: 'c1', ticks: allSkills() }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.upsertRating).not.toHaveBeenCalled();
  });

  it("refuses the rater's own practice", async () => {
    const { repository, service } = build();
    repository.getCutForRating.mockResolvedValueOnce({
      cutId: 'c1',
      userId: RATER,
      judgeScored: true,
    });
    await expect(
      service.submit(RATER, { cutId: 'c1', ticks: allSkills() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unknown codes with every problem listed, and writes nothing', async () => {
    const { repository, service } = build();
    const err = await service
      .submit(RATER, {
        cutId: 'c1',
        ticks: allSkills({
          opportunity: true,
          observed: ['verbal.b9', 'harm.b1'],
        }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      message: [
        '"verbal.b9" is not a behaviour of skill "verbal"',
        '"harm.b1" is not a behaviour of skill "verbal"',
      ],
    });
    expect(repository.upsertRating).not.toHaveBeenCalled();
  });
});

describe('FhsHumanRatingService.getSample', () => {
  const NOW = new Date('2026-10-05T12:00:00Z');

  it('defaults to the last complete quarter and draws 30 from a large one', async () => {
    const { repository, service } = build();
    repository.getQuarterCandidates.mockResolvedValueOnce(
      Array.from({ length: 80 }, (_, i) => candidate(i + 1)),
    );
    const out = await service.getSample(RATER, undefined, NOW);
    expect(repository.getQuarterCandidates).toHaveBeenCalledWith(
      'fhs-text-v1',
      { key: '2026Q3', startDate: '2026-07-01', endDate: '2026-10-01' },
    );
    expect(out).toMatchObject({
      quarter: '2026Q3',
      quarterStart: '2026-07-01',
      quarterEnd: '2026-10-01',
      quarterComplete: true,
      rubricVersion: 'fhs-text-v1',
      target: 30,
      population: 80,
    });
    expect(out.items).toHaveLength(30);
    expect(repository.getRatingCounts).toHaveBeenCalledWith(
      'fhs-text-v1',
      out.items.map((i) => i.cutId),
      RATER,
    );
  });

  it('returns the same sample on every call', async () => {
    const { repository, service } = build();
    const pool = Array.from({ length: 80 }, (_, i) => candidate(i + 1));
    repository.getQuarterCandidates.mockResolvedValue(pool);
    const a = await service.getSample(RATER, '2026Q3', NOW);
    repository.getQuarterCandidates.mockResolvedValue([...pool].reverse());
    const b = await service.getSample(RATER + 1, '2026Q3', NOW);
    expect(b.items.map((i) => i.cutId)).toEqual(a.items.map((i) => i.cutId));
  });

  it('marks rater counts, the caller’s own ratings and own practice; carries ids only', async () => {
    const { repository, service } = build();
    const own = candidate(1, RATER);
    const other = candidate(2);
    repository.getQuarterCandidates.mockResolvedValueOnce([own, other]);
    repository.getRatingCounts.mockResolvedValueOnce(
      new Map([[other.cutId, { raters: 2, ratedByMe: true }]]),
    );
    const out = await service.getSample(RATER, '2026Q4', NOW);
    expect(out.quarterComplete).toBe(false);
    const byId = new Map(out.items.map((i) => [i.cutId, i]));
    expect(byId.get(own.cutId)).toMatchObject({
      ownPractice: true,
      raters: 0,
      ratedByMe: false,
    });
    expect(byId.get(other.cutId)).toEqual({
      cutId: other.cutId,
      closedAt: '2026-08-01T10:00:00.000Z',
      sessionIds: ['s2'],
      startSessionId: 's2',
      startMessageId: 20,
      endSessionId: 's2',
      endMessageId: 29,
      startsMidSession: false,
      endsMidSession: true,
      language: 'en',
      tercile: expect.any(Number),
      raters: 2,
      ratedByMe: true,
      ownPractice: false,
    });
  });

  it('rejects a malformed quarter', async () => {
    const { service } = build();
    await expect(
      service.getSample(RATER, '2026Q5', NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
