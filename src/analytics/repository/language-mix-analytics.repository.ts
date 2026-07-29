import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/**
 * How many series a categorical breakdown may draw.
 *
 * Eight is the ceiling because it is roughly where a categorical palette stops
 * working: past it the colours are no longer told apart at a glance, the legend
 * needs two rows, and the reader is matching hues instead of reading a chart. The
 * tail is pooled into a single {@link LANGUAGE_MIX_OTHER_LABEL} band SERVER-side —
 * if the server shipped every language and left the trimming to the client, one
 * client would draw a ninth colour, another would drop the tail and understate its
 * own totals, and the two would disagree about the same data.
 *
 * It is echoed to the client so the legend, the palette and any "show the rest"
 * affordance are built from the server's ceiling rather than a second copy of it.
 */
export const MAX_LANGUAGE_SERIES = 8;

/**
 * Label for the pooled tail. Named "Other" rather than "Other languages" because
 * it sits in a legend of language names, where the shorter word reads as a
 * category and the longer one reads as a language.
 */
export const LANGUAGE_MIX_OTHER_LABEL = 'Other';

/**
 * Label for sessions whose language cannot be resolved.
 *
 * Deliberately NOT folded into "Other" and never silently dropped: "Other" is a
 * statement about known languages that are individually small, while this is an
 * absence of data. A missing-data category that hides inside a real one is how a
 * measurement gap becomes invisible exactly when it is growing.
 */
export const LANGUAGE_MIX_UNKNOWN_LABEL = 'Unknown';

/** One (bucket, language) cell of the mix. */
export interface LanguageMixBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** Resolved language label, or {@link LANGUAGE_MIX_UNKNOWN_LABEL}. */
  label: string;
  /** Completed sessions in this bucket, in this language. */
  sessions: number;
}

/**
 * Which languages is practice actually happening in, and how is that mix moving?
 *
 * The question behind it is an investment one: voices, prompts and evaluation
 * rubrics are built per language, and a mix chart is the only view that says
 * whether the language a team is about to spend a quarter on carries 2% of
 * practice or 40%.
 *
 * Language comes from `scenario_sessions.metadata->>'languageId'` resolved against
 * the `languages` table, the same LEFT JOIN convention the drift and language-quality
 * repositories use, so a language's name is spelled one way across the whole
 * analytics surface. Three deliberate choices in that join:
 *
 *  - `languages.active` is IGNORED. A session played in a since-retired language
 *    still happened in that language; filtering on the flag would rewrite history
 *    as {@link LANGUAGE_MIX_UNKNOWN_LABEL} every time a language was switched off.
 *  - An unresolvable id becomes `Unknown` rather than being dropped, and rather
 *    than being assumed to be English. `COALESCE(l.value, 'en')` is the right
 *    default for the drift judge, which needs *a* language to score against; it
 *    would be a fabrication here, where the mix itself is the subject.
 *  - The label prefers `languages.label` (the display name) over `value` (the
 *    locale code), falling back to the code when a row has no label, so the legend
 *    reads as language names and never as an empty string.
 *
 * COMPLETED sessions only: the mix should describe practice that happened, and
 * abandoned launches skew toward whatever language a broken voice or an unsupported
 * locale was configured in. Bucketed on `COALESCE(startedAt, createdAt)`, matching
 * {@link CompletionRateAnalyticsRepository} exactly, so the two charts' per-bucket
 * completed-session totals reconcile instead of nearly agreeing.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables BY
 * NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), dates out as `yyyy-mm-dd` strings, counts `::int` and re-parsed
 * defensively, every literal bound as a parameter.
 */
@Injectable()
export class LanguageMixAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * See {@link getPlatformDataFloor}. The same measurement every other analytics
   * endpoint uses, so the axes on one tab cover the same period.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Completed sessions per (bucket, language), long form.
   *
   * Long form rather than one row per bucket with a column per language: the set of
   * languages is data, not schema, so a wide shape would need the query to know the
   * legend before it runs — and the ranking that decides the legend is computed from
   * these very rows.
   *
   * No ranking, pooling or trimming happens here. Every language that had a session
   * comes back, and the service decides which ones survive as named series — that
   * way the pooled "Other" band is a sum over the true tail rather than over
   * whatever a `LIMIT` happened to cut, and the bucket totals stay exact.
   */
  async getSessionsByBucketAndLanguage(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<LanguageMixBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const params: unknown[] = [
      start,
      end,
      ScenarioSessionEventStatus.COMPLETED,
      LANGUAGE_MIX_UNKNOWN_LABEL,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant(
        's."tenant_id"',
        `$${params.length}`,
      )}`;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(
          date_trunc('${trunc}', COALESCE(s."startedAt", s."createdAt")),
          'YYYY-MM-DD'
        )                                                          AS "bucket",
        COALESCE(NULLIF(l.label, ''), NULLIF(l.value, ''), $4)      AS "label",
        COUNT(*)::int                                              AS "sessions"
      FROM scenario_sessions s
      LEFT JOIN languages l
        ON l.id = NULLIF(s.metadata->>'languageId', '')::int
      WHERE s."eventStatus" = $3
        AND ${countableSessionPredicate('s')}
        AND COALESCE(s."startedAt", s."createdAt") >= $1
        AND COALESCE(s."startedAt", s."createdAt") < $2
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 3 DESC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      label: r.label as string,
      sessions: Number(r.sessions) || 0,
    }));
  }
}
