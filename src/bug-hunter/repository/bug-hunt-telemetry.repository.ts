import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { BugHuntPhaseTiming } from '../entity/bug-hunt-phase.entity';
import { BugHuntContextLookup } from '../entity/bug-hunt-context-lookup.entity';
import {
  BugHuntLookupKind,
  BugHuntPhase,
} from '../enum/bug-hunt-telemetry.enum';

export interface PhaseDurationStats {
  phase: BugHuntPhase;
  /** Finished phases in the window — the sample the percentiles are over. */
  samples: number;
  /** Phases started but never finished in the window — a run that died mid-phase. */
  unfinished: number;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface LookupKindStats {
  kind: BugHuntLookupKind;
  calls: number;
  /** Share of calls that returned at least one item. Null when there were no calls. */
  hitRate: number | null;
  medianLatencyMs: number | null;
  avgItems: number | null;
  avgChars: number | null;
  /** Mean top relevance over the calls that reported one. Null when none did. */
  avgRelevance: number | null;
  /** Items used ÷ items returned, over the calls that reported usage. Null when none did. */
  usedShare: number | null;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

@Injectable()
export class BugHuntPhaseRepository extends Repository<BugHuntPhaseTiming> {
  constructor(dataSource: DataSource) {
    super(BugHuntPhaseTiming, dataSource.createEntityManager());
  }

  listForRun(runId: string): Promise<BugHuntPhaseTiming[]> {
    return this.find({ where: { runId }, order: { startedAt: 'ASC' } });
  }

  /**
   * Median and p90 duration per phase over phases that STARTED in the window,
   * plus how many never finished.
   *
   * Cohorted by start rather than finish so a phase that began inside the
   * window and is still open counts as unfinished here instead of vanishing:
   * "the verify phase never finished on three runs this week" is the single
   * most useful thing this table can say about a bad week.
   */
  async durationStats(since: Date): Promise<PhaseDurationStats[]> {
    const rows = await this.createQueryBuilder('p')
      .select('p.phase', 'phase')
      .addSelect('COUNT(*) FILTER (WHERE p.duration_ms IS NOT NULL)', 'samples')
      .addSelect('COUNT(*) FILTER (WHERE p.duration_ms IS NULL)', 'unfinished')
      .addSelect(
        'percentile_cont(0.5) WITHIN GROUP (ORDER BY p.duration_ms)',
        'median_ms',
      )
      .addSelect(
        'percentile_cont(0.9) WITHIN GROUP (ORDER BY p.duration_ms)',
        'p90_ms',
      )
      .where('p.started_at >= :since', { since })
      .groupBy('p.phase')
      .orderBy('p.phase', 'ASC')
      .getRawMany();

    return rows.map((row) => ({
      phase: row.phase,
      samples: Number(row.samples),
      unfinished: Number(row.unfinished),
      medianMs: num(row.median_ms),
      p90Ms: num(row.p90_ms),
    }));
  }
}

@Injectable()
export class BugHuntContextLookupRepository extends Repository<BugHuntContextLookup> {
  constructor(dataSource: DataSource) {
    super(BugHuntContextLookup, dataSource.createEntityManager());
  }

  listForRun(runId: string): Promise<BugHuntContextLookup[]> {
    return this.find({ where: { runId }, order: { createdAt: 'ASC' } });
  }

  /**
   * Per kind, over lookups in the window: how often the agent asked, how often
   * it got anything back, how long it waited, how much it was handed — and,
   * where the lookup ranked its results, how relevant they were and how much
   * of them the agent used.
   *
   * `hitRate`'s denominator is every call, because "asked for prod logs and
   * got none" is exactly the fact a quiet-night policy needs. `usedShare` and
   * `avgRelevance` divide only by calls that reported the figure, since the
   * server-recorded kinds never do and a zero there would be a lie.
   */
  async kindStats(since: Date): Promise<LookupKindStats[]> {
    const rows = await this.createQueryBuilder('l')
      .select('l.kind', 'kind')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COUNT(*) FILTER (WHERE l.item_count > 0)', 'hits')
      .addSelect(
        'percentile_cont(0.5) WITHIN GROUP (ORDER BY l.latency_ms)',
        'median_latency_ms',
      )
      .addSelect('AVG(l.item_count)', 'avg_items')
      .addSelect('AVG(l.chars)', 'avg_chars')
      .addSelect('AVG(l.relevance)', 'avg_relevance')
      .addSelect(
        'SUM(l.used_count) FILTER (WHERE l.used_count IS NOT NULL)',
        'used_sum',
      )
      .addSelect(
        'SUM(l.item_count) FILTER (WHERE l.used_count IS NOT NULL)',
        'used_denominator',
      )
      .where('l."createdAt" >= :since', { since })
      .groupBy('l.kind')
      .orderBy('l.kind', 'ASC')
      .getRawMany();

    return rows.map((row) => {
      const calls = Number(row.calls);
      const usedDenominator = num(row.used_denominator);
      return {
        kind: row.kind,
        calls,
        hitRate: calls === 0 ? null : Number(row.hits) / calls,
        medianLatencyMs: num(row.median_latency_ms),
        avgItems: num(row.avg_items),
        avgChars: num(row.avg_chars),
        avgRelevance: num(row.avg_relevance),
        usedShare:
          usedDenominator === null || usedDenominator === 0
            ? null
            : Number(row.used_sum) / usedDenominator,
      };
    });
  }
}
