import { UxSignalReadService } from '../ux-signal-read.service';
import { BugFindingSource } from 'src/bug-hunter/enum/bug-finding.enum';
import {
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
} from 'src/analytics-suggestions/enum/analytics-suggestion.enum';
import { UX_SIGNAL_EVIDENCE_LIMITS } from '../../constants/ux-signals.constants';

/**
 * The read side's three load-bearing properties, each of which fails silently
 * if it regresses:
 *
 *  1. A rejected suggestion never comes back. The queue's own anti-repetition
 *     rule exists because re-proposing a decided card is how a review queue
 *     loses its readers; laundering one through a PRD is the same failure.
 *  2. The scan window survives the projection. Friction with no dates gets
 *     stated in the present tense.
 *  3. "Nothing has looked" and "nothing is wrong" stay distinguishable.
 */
describe('UxSignalReadService', () => {
  const suggestionQuery = () => {
    const calls: { sql: string; params: Record<string, any> }[] = [];
    const builder: any = {
      where: (sql: string, params: any) => {
        calls.push({ sql, params });
        return builder;
      },
      andWhere: (sql: string, params: any) => {
        calls.push({ sql, params });
        return builder;
      },
      orderBy: () => builder,
      take: (n: number) => {
        builder.taken = n;
        return builder;
      },
      getMany: jest.fn().mockResolvedValue([]),
      calls,
    };
    return builder;
  };

  const build = (over: Record<string, any> = {}) => {
    const suggestionBuilder = over.suggestionBuilder ?? suggestionQuery();
    const service = new UxSignalReadService(
      {
        findOne: jest.fn().mockResolvedValue(over.scan ?? null),
      } as never,
      {
        listOpenBySource: jest.fn().mockResolvedValue(over.findings ?? []),
      } as never,
      { createQueryBuilder: () => suggestionBuilder } as never,
    );
    return { service, suggestionBuilder };
  };

  it('asks only for UX-sourced findings, never the whole backlog', async () => {
    const { service } = build();
    const findingRepository = (service as any).findingRepository;

    await service.frictionEvidence('scribe');

    expect(findingRepository.listOpenBySource).toHaveBeenCalledWith(
      BugFindingSource.UX_SIGNAL,
      'scribe',
      UX_SIGNAL_EVIDENCE_LIMITS.DEFAULT,
    );
  });

  it('never returns a rejected suggestion', async () => {
    const { service, suggestionBuilder } = build();

    await service.frictionEvidence();

    const statusClause = suggestionBuilder.calls.find((call: any) =>
      call.sql.includes('s.status'),
    );
    expect(statusClause.params.statuses).toEqual([
      AnalyticsSuggestionStatus.PENDING,
      AnalyticsSuggestionStatus.ACCEPTED,
    ]);
    expect(statusClause.params.statuses).not.toContain(
      AnalyticsSuggestionStatus.REJECTED,
    );

    const sourceClause = suggestionBuilder.calls.find((call: any) =>
      call.sql.includes('s.source'),
    );
    expect(sourceClause.params.source).toBe(
      AnalyticsSuggestionSource.UX_SIGNAL,
    );
  });

  it('carries the scan window and splits the route back out of the symbol', async () => {
    const { service } = build({
      scan: {
        windowFrom: '2026-09-07',
        windowTo: '2026-09-13',
        startedAt: new Date('2026-09-14T02:00:00.000Z'),
      },
      findings: [
        {
          id: 'f1',
          title: 'Dead clicks on Save',
          symbol: '/scribe/session|button.save',
          severity: 'high',
          status: 'new',
          createdAt: new Date('2026-09-13T09:00:00.000Z'),
        },
      ],
    });

    const result = await service.frictionEvidence();

    expect(result.scan).toEqual({
      windowFrom: '2026-09-07',
      windowTo: '2026-09-13',
      startedAt: '2026-09-14T02:00:00.000Z',
    });
    expect(result.findings[0].route).toBe('/scribe/session');
  });

  it('reports a null scan rather than an empty one when nothing has run', async () => {
    const { service } = build({ scan: null });

    const result = await service.frictionEvidence();

    expect(result.scan).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('clamps an oversized limit rather than letting a caller ask for everything', async () => {
    const { service } = build();

    await service.frictionEvidence(undefined, 10_000);

    expect(
      (service as any).findingRepository.listOpenBySource,
    ).toHaveBeenCalledWith(
      BugFindingSource.UX_SIGNAL,
      undefined,
      UX_SIGNAL_EVIDENCE_LIMITS.MAX,
    );
  });
});
