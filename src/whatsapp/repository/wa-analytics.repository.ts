import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WaMessage } from '../entity/wa-message.entity';
import { WaHandledBy, WaMessageDirection } from '../enum/whatsapp.enum';

export interface AnalyticsWindow {
  from: Date;
  to: Date;
}

/**
 * Read-only aggregate queries for the usage dashboard.
 *
 * Computed on demand from `wa_messages` rather than from a rollup table. At this feature's volume a
 * few indexed aggregates over a date range are cheap, and a rollup would add a scheduled job plus a
 * second source of truth that can silently disagree with the messages it summarises. If the tab ever
 * becomes slow, `wa_daily_stats` is the fix — but adding it before there is a problem would be
 * inventing maintenance work.
 */
@Injectable()
export class WaAnalyticsRepository extends Repository<WaMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(WaMessage, dataSource.createEntityManager());
  }

  /** Headline counts for the window. */
  async overview(window: AnalyticsWindow) {
    const base = () =>
      this.createQueryBuilder('m')
        .where('m."createdAt" >= :from', { from: window.from })
        .andWhere('m."createdAt" < :to', { to: window.to });

    const [inbound, outbound] = await Promise.all([
      base()
        .andWhere('m.direction = :direction', {
          direction: WaMessageDirection.INBOUND,
        })
        .getCount(),
      base()
        .andWhere('m.direction = :direction', {
          direction: WaMessageDirection.OUTBOUND,
        })
        .getCount(),
    ]);

    const uniqueContactsRow = await base()
      .select('COUNT(DISTINCT m.contact_id)', 'count')
      .getRawOne<{ count: string }>();

    const byHandledBy = await base()
      .select('m.handled_by', 'handledBy')
      .addSelect('COUNT(*)', 'count')
      .andWhere('m.handled_by IS NOT NULL')
      .andWhere('m.direction = :direction', {
        direction: WaMessageDirection.OUTBOUND,
      })
      .groupBy('m.handled_by')
      .getRawMany<{ handledBy: string; count: string }>();

    const outcomes = byHandledBy.reduce<Record<string, number>>((acc, row) => {
      acc[row.handledBy] = Number(row.count);
      return acc;
    }, {});

    // Percentiles rather than a mean: one 20-second outlier drags an average enough to hide that the
    // typical reply is fast, and the p95 is what a worker waiting on a slow answer experiences.
    const latencyRow = await base()
      .select(
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.latency_ms)',
        'p50',
      )
      .addSelect(
        'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.latency_ms)',
        'p95',
      )
      .andWhere('m.latency_ms IS NOT NULL')
      .getRawOne<{ p50: string | null; p95: string | null }>();

    const answered = outcomes[WaHandledBy.RAG] ?? 0;
    const declined = outcomes[WaHandledBy.DECLINED] ?? 0;

    return {
      inbound,
      outbound,
      uniqueContacts: Number(uniqueContactsRow?.count ?? 0),
      answered,
      declined,
      clarified: outcomes[WaHandledBy.CLARIFIED] ?? 0,
      crisis: outcomes[WaHandledBy.CRISIS] ?? 0,
      template: outcomes[WaHandledBy.TEMPLATE] ?? 0,
      errors: outcomes[WaHandledBy.ERROR] ?? 0,
      rateLimited: outcomes[WaHandledBy.RATE_LIMITED] ?? 0,
      // Share of questions that actually reached the corpus, so a period dominated by greetings does
      // not read as a corpus failure.
      declineRate:
        answered + declined === 0 ? null : declined / (answered + declined),
      latencyP50Ms: latencyRow?.p50 ? Math.round(Number(latencyRow.p50)) : null,
      latencyP95Ms: latencyRow?.p95 ? Math.round(Number(latencyRow.p95)) : null,
    };
  }

  /** One metric bucketed by day, for the trend chart. */
  async timeseries(window: AnalyticsWindow) {
    const rows = await this.createQueryBuilder('m')
      .select('DATE_TRUNC(\'day\', m."createdAt")', 'bucket')
      .addSelect('m.handled_by', 'handledBy')
      .addSelect('COUNT(*)', 'count')
      .where('m."createdAt" >= :from', { from: window.from })
      .andWhere('m."createdAt" < :to', { to: window.to })
      .andWhere('m.direction = :direction', {
        direction: WaMessageDirection.OUTBOUND,
      })
      .andWhere('m.handled_by IS NOT NULL')
      .groupBy('bucket')
      .addGroupBy('m.handled_by')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: Date; handledBy: string; count: string }>();

    return rows.map((row) => ({
      bucket: row.bucket,
      handledBy: row.handledBy,
      count: Number(row.count),
    }));
  }

  /**
   * Inbound language mix with each language's decline rate.
   *
   * The decline rate BY LANGUAGE is the single most important number this dashboard carries: it is
   * how the cross-lingual retrieval risk becomes a measurement rather than an argument. If Hindi or
   * Tamil declines far more often than English, retrieval is failing before the answer is written,
   * and the translate-before-embed step is where to look.
   */
  async languages(window: AnalyticsWindow) {
    const rows = await this.createQueryBuilder('m')
      .select('COALESCE(m.language, :unknown)', 'language')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN m.handled_by = :declined THEN 1 ELSE 0 END)`,
        'declined',
      )
      .addSelect(
        `SUM(CASE WHEN m.handled_by = :rag THEN 1 ELSE 0 END)`,
        'answered',
      )
      .where('m."createdAt" >= :from', { from: window.from })
      .andWhere('m."createdAt" < :to', { to: window.to })
      .andWhere('m.direction = :direction', {
        direction: WaMessageDirection.OUTBOUND,
      })
      .andWhere('m.handled_by IN (:...outcomes)', {
        outcomes: [WaHandledBy.RAG, WaHandledBy.DECLINED],
      })
      .setParameters({
        unknown: 'unknown',
        declined: WaHandledBy.DECLINED,
        rag: WaHandledBy.RAG,
      })
      .groupBy('COALESCE(m.language, :unknown)')
      .orderBy('total', 'DESC')
      .getRawMany<{
        language: string;
        total: string;
        declined: string;
        answered: string;
      }>();

    return rows.map((row) => {
      const total = Number(row.total);
      const declined = Number(row.declined);
      return {
        language: row.language,
        total,
        answered: Number(row.answered),
        declined,
        // Null below a minimum sample rather than a percentage from three messages. A "100% decline
        // rate" computed from one question invites a decision the data cannot support.
        declineRate: total >= MIN_SAMPLE_FOR_RATE ? declined / total : null,
      };
    });
  }

  /**
   * Which documents are being cited — and by omission, which never are.
   *
   * The dead-corpus half is the useful half: a document that has never been cited is either badly
   * chunked, badly titled for retrieval, or about something nobody asks.
   */
  async corpusCoverage(window: AnalyticsWindow) {
    const rows = await this.dataSource.query<
      { document_id: string; citations: string }[]
    >(
      `SELECT citation->>'document_id' AS document_id, COUNT(*) AS citations
         FROM "wa_messages" m,
              jsonb_array_elements(m.citations) AS citation
        WHERE m."createdAt" >= $1
          AND m."createdAt" < $2
          AND m.citations IS NOT NULL
        GROUP BY citation->>'document_id'
        ORDER BY citations DESC`,
      [window.from, window.to],
    );

    return rows.map((row) => ({
      documentId: row.document_id,
      citations: Number(row.citations),
    }));
  }
}

/**
 * Minimum inbound messages before a per-language rate is reported.
 *
 * Matches the admin analytics kit's existing MIN_N_FOR_SCORE floor, for the same reason: a ratio over
 * a handful of samples reads as signal and is noise.
 */
export const MIN_SAMPLE_FOR_RATE = 20;
