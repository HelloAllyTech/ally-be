import { DataSource } from 'typeorm';

import { BugHuntEventRepository } from '../bug-hunt-event.repository';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';

/**
 * `escalationBreakdown` is the cheapest possible answer to "why do sessions
 * escalate": grouping on the raw `summary` text already separates the three
 * escalation paths that report a fixed, literal string per call site — see
 * the method's own doc.
 */
describe('BugHuntEventRepository.escalationBreakdown', () => {
  const build = (rawRows: Array<{ summary: string; count: string }>) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawRows),
    };
    const repository = new BugHuntEventRepository({
      createEntityManager: () => ({}),
    } as unknown as DataSource);
    jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb as never);
    return { repository, qb };
  };

  it('filters to the escalated stage within the window', async () => {
    const since = new Date('2026-09-01T00:00:00.000Z');
    const { repository, qb } = build([]);

    await repository.escalationBreakdown(since);

    expect(qb.where).toHaveBeenCalledWith('e.stage = :stage', {
      stage: BugHuntEventStage.ESCALATED,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('e.createdAt >= :since', {
      since,
    });
    expect(qb.groupBy).toHaveBeenCalledWith('e.summary');
  });

  it('coerces the raw count to a number', async () => {
    const { repository } = build([
      { summary: 'suite still red after the attempt cap', count: '4' },
    ]);

    const result = await repository.escalationBreakdown(new Date());

    expect(result).toEqual([
      { summary: 'suite still red after the attempt cap', count: 4 },
    ]);
  });
});
