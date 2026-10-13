import { BugFindingStatus } from '../../enum/bug-finding.enum';
import {
  BugHunterPrecedentService,
  precedentKeywords,
  renderPrecedents,
  toPrecedent,
} from '../bug-hunter-precedent.service';

describe('BugHunterPrecedentService', () => {
  it('keeps the words that carry meaning, most frequent first', () => {
    const words = precedentKeywords(
      'Simulation titles stay English. The simulation title should be Marathi when the user selects Marathi.',
    );
    expect(words.slice(0, 2)).toEqual(['marathi', 'simulation']);
    expect(words).not.toContain('should');
    expect(words).not.toContain('the');
  });

  it('asks Postgres for informative look-alikes, excluding the bug itself, ranked', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getMany = jest.fn().mockResolvedValue([]);
    const service = new BugHunterPrecedentService({
      createQueryBuilder: jest.fn(() => qb),
    } as never);
    await service.similar({
      id: 'f-new',
      title: 'Tooltip stays English in Marathi',
      description:
        'The close tooltip is English after switching language to Marathi.',
    });
    expect(qb.where).toHaveBeenCalledWith('f.id <> :id', { id: 'f-new' });
    const statuses = qb.andWhere.mock.calls.find(([sql]) =>
      String(sql).includes('status'),
    )?.[1].statuses;
    expect(statuses).toEqual(
      expect.arrayContaining([
        BugFindingStatus.RELEASED,
        BugFindingStatus.REJECTED,
        BugFindingStatus.CANCELLED,
      ]),
    );
    const q = qb.andWhere.mock.calls.find(([sql]) =>
      String(sql).includes('to_tsquery'),
    )?.[1].q;
    expect(q).toMatch(/marathi \| /);
    expect(qb.limit).toHaveBeenCalledWith(3);
  });

  it('says how a look-alike ended: the located fault, a wrong fix, or why it was declined', () => {
    const p = toPrecedent({
      id: 'f-old',
      title: 'Simulation titles English in Marathi',
      repo: 'ally-web',
      status: BugFindingStatus.CANCELLED,
      prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
      metadata: {
        findingVerdicts: [
          {
            verdict: 'confirmed',
            fault: {
              layer: 'data',
              repo: 'ally-be',
              repair: 'backfill translations',
            },
          },
        ],
        wrongFix: {
          link: 'changed',
          source: 'verifier',
          reason: 'fixed in the frontend',
          at: '2026-10-12',
        },
      },
    } as never);
    expect(p.fault).toEqual({
      layer: 'data',
      repo: 'ally-be',
      repair: 'backfill translations',
    });
    const text = renderPrecedents([p]).join('\n');
    expect(text).toContain(
      'Fault located in data (ally-be); repair: backfill translations.',
    );
    expect(text).toContain(
      'Its fix was WRONG at "changed": fixed in the frontend',
    );
    expect(renderPrecedents([])).toEqual([]);
  });
});
