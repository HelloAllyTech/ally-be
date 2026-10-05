import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { HUMAN_RATING_UNKNOWN_LANGUAGE } from '../constants/fhs-human-rating.constants';

/**
 * The cuts the human-rating sample is drawn from, as SQL — one definition for
 * the sampling API and the agreement chart's coverage, so "sampled cuts" on
 * the chart can never disagree with what a rater was given.
 *
 * A cut qualifies when the judge SCORED it under the rubric version bound to
 * `rubricParam` with a composite (nothing assessable → nothing to stratify or
 * compare), and it is not in a test organisation. Its quarter is the calendar
 * quarter of `closedSessionEndedAt`, the cut's place in time everywhere else.
 * `startParam`/`endParam`, when given, bound that column to `[start, end)` as
 * `YYYY-MM-DD` wall-clock dates (the column is a `timestamp`, no zone).
 *
 * `language` is the cut's MAJORITY session language: the `languages.value`
 * code behind `metadata->>'languageId'` of the sessions in `sessionIds`, the
 * most frequent winning, ties to the language of the session the cut closed
 * in, then alphabetically. `languages.active` is ignored (a retired language
 * was still the one spoken) and an unresolvable id is
 * {@link HUMAN_RATING_UNKNOWN_LANGUAGE}, never assumed to be English.
 *
 * Columns: cut_id, user_id, closed_at, quarter (`YYYYQn`), composite (float),
 * session_ids, start_session_id, start_message_id, end_session_id,
 * end_message_id, starts_mid_session, ends_mid_session, language.
 */
export function humanRatingPopulationSql(opts: {
  rubricParam: string;
  startParam?: string;
  endParam?: string;
}): string {
  const window =
    opts.startParam && opts.endParam
      ? `
         AND c."closedSessionEndedAt" >= ${opts.startParam}::timestamp
         AND c."closedSessionEndedAt" < ${opts.endParam}::timestamp`
      : '';
  return `
      SELECT c.id::text AS cut_id,
             c."userId" AS user_id,
             c."closedSessionEndedAt" AS closed_at,
             to_char(c."closedSessionEndedAt", 'YYYY"Q"Q') AS quarter,
             a."compositeScore"::float AS composite,
             c."sessionIds" AS session_ids,
             c."startSessionId"::text AS start_session_id,
             c."startMessageId" AS start_message_id,
             c."endSessionId"::text AS end_session_id,
             c."endMessageId" AS end_message_id,
             c."startsMidSession" AS starts_mid_session,
             c."endsMidSession" AS ends_mid_session,
             COALESCE(lang.language, '${HUMAN_RATING_UNKNOWN_LANGUAGE}') AS language
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(NULLIF(l.value, ''), '${HUMAN_RATING_UNKNOWN_LANGUAGE}') AS language
            FROM unnest(c."sessionIds") AS cs(session_id)
            JOIN scenario_sessions ss ON ss.id = cs.session_id
            LEFT JOIN languages l
              ON l.id = NULLIF(ss.metadata->>'languageId', '')::int
           GROUP BY 1
           ORDER BY COUNT(*) DESC, bool_or(ss.id = c."endSessionId") DESC, 1 ASC
           LIMIT 1
        ) lang ON true
       WHERE a."rubricVersion" = ${opts.rubricParam}
         AND a.status = 'SCORED'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}${window}`;
}
