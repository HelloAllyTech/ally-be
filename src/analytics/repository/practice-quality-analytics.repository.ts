import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { AnalyticsBucket } from './platform-analytics.repository';
import { resolveSqlBucket } from '../util/analytics-window.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import {
  countableSessionPredicate,
  sessionDurationMsExpr,
} from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/** `scenario_session_messages.senderId` of the AI character (the client). */
const AI_SENDER_ID = -1;

/**
 * Client utterances that are not the reply: a thinking filler spoken while the
 * reply forms, and a non-committal holding reply (`utteranceKind`, written by
 * ally-ai-learn on CLIENT lines; the third value is 'reply'). Counting them as
 * client speech would lower every learner's share by the persona's filler
 * habit, which varies by build and voice, not by learner.
 */
export const NON_REPLY_UTTERANCE_KINDS = ['filler', 'interim'] as const;

/**
 * What makes a session count as practice (EFF-50b). All three must hold:
 * enough turns that it was a conversation, enough time that it was not a
 * mis-start, and enough of the learner's own words that there was something
 * to practise on. Served in the payload as `practiceThresholds`.
 */
export const PRACTICE_THRESHOLDS = {
  minLearnerTurns: 3,
  minDurationMinutes: 2,
  minLearnerChars: 300,
} as const;

/** One bucket (or, with `bucket` null, the whole window). Percentiles RAW. */
export interface PracticeQualityRow {
  /** yyyy-mm-dd bucket start; null on the whole-window total row. */
  bucket: string | null;
  sessions: number;
  talkShareSessions: number;
  talkShareP25: number | null;
  talkShareMedian: number | null;
  talkShareP75: number | null;
  learnerTurnsMedian: number | null;
  practiceSessions: number;
  shortTurnSessions: number;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Transcript shape per countable session, for Highlights → Usage (AAQ-208/209).
 *
 * ONE statement, aggregated in SQL end to end: the messages of the window's
 * sessions are summed per session in a single GROUP BY, those per-session
 * figures are reduced per bucket AND for the whole window in one pass
 * (`GROUPING SETS`), and only the bucket rows travel. Transcripts are the
 * largest table on the platform; no message row is ever read into Node.
 *
 * - **Who spoke.** Learner = `senderId <> -1`; the client (the AI character) is
 *   `-1`. Client filler/interim utterances are dropped before anything is
 *   counted. Characters are counted on `btrim(content)`, and a turn is a
 *   non-empty learner line.
 * - **Which sessions.** Countable only (`ENDED` + `COMPLETED`, no preview or
 *   seed rooms), test organisations excluded, bucketed on
 *   `COALESCE(endedAt, createdAt)` like the qualifying-session chart beside it.
 *   Duration is `sessionDurationMsExpr` (net of pauses) over the details join.
 * - **Language.** The session's configured language,
 *   `languages.value` via `metadata->>'languageId'`, defaulting to 'en' when it
 *   does not resolve — the same predicate the latency and drift filters use.
 * - **Org.** The session's own tenant, bound as a parameter.
 *
 * A session with no speech at all has no talk share (0 ÷ 0 is not 0%): it is
 * still a session, and still not practice, but it stays out of the share's
 * percentiles.
 */
@Injectable()
export class PracticeQualityAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Where the platform's data begins — the left edge of `range=all`. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getPracticeQuality(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    opts: { tenantId?: string; language?: string } = {},
  ): Promise<PracticeQualityRow[]> {
    // Bound, but still whitelisted: nothing reaches date_trunc unchecked.
    const trunc = resolveSqlBucket(
      bucket,
      ['day', 'week', 'month', 'quarter', 'year'],
      'month',
    );
    const params: unknown[] = [
      trunc,
      start,
      end,
      PRACTICE_THRESHOLDS.minLearnerTurns,
      PRACTICE_THRESHOLDS.minDurationMinutes * 60_000,
      PRACTICE_THRESHOLDS.minLearnerChars,
    ];
    let filters = '';
    if (opts.tenantId) {
      params.push(opts.tenantId);
      filters += `\n           AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }
    let languageJoin = '';
    if (opts.language) {
      params.push(opts.language);
      languageJoin = `\n          LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int`;
      filters += `\n           AND COALESCE(l.value, 'en') = $${params.length}`;
    }
    const nonReply = NON_REPLY_UTTERANCE_KINDS.map((k) => `'${k}'`).join(', ');

    const rows = await this.dataSource.query(
      `
      WITH sess AS (
        SELECT s.id,
               to_char(date_trunc($1, COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD') AS bucket,
               ${sessionDurationMsExpr('s', 'd')} AS duration_ms
          FROM scenario_sessions s
          LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id${languageJoin}
         WHERE s.status = '${ScenarioSessionStatus.ENDED}'
           AND s."eventStatus" = '${ScenarioSessionEventStatus.COMPLETED}'
           AND COALESCE(s."endedAt", s."createdAt") >= $2
           AND COALESCE(s."endedAt", s."createdAt") < $3
           AND ${countableSessionPredicate('s')}
           AND ${excludeTestTenants('s."tenant_id"')}${filters}
      ),
      talk AS (
        SELECT m."scenarioSessionId" AS session_id,
               SUM(char_length(btrim(m.content)))
                 FILTER (WHERE m."senderId" <> ${AI_SENDER_ID}) AS learner_chars,
               SUM(char_length(btrim(m.content))) AS all_chars,
               COUNT(*) FILTER (WHERE m."senderId" <> ${AI_SENDER_ID}
                                  AND btrim(m.content) <> '') AS learner_turns
          FROM scenario_session_messages m
          JOIN sess ON sess.id = m."scenarioSessionId"
         WHERE COALESCE(m.metadata->>'utteranceKind', '') NOT IN (${nonReply})
         GROUP BY m."scenarioSessionId"
      ),
      per AS (
        SELECT sess.bucket, sess.duration_ms,
               COALESCE(t.learner_chars, 0) AS learner_chars,
               COALESCE(t.learner_turns, 0) AS learner_turns,
               CASE WHEN COALESCE(t.all_chars, 0) > 0
                    THEN COALESCE(t.learner_chars, 0)::float / t.all_chars * 100
               END AS talk_share
          FROM sess
          LEFT JOIN talk t ON t.session_id = sess.id
      )
      SELECT per.bucket,
             GROUPING(per.bucket) AS is_total,
             COUNT(*)::int AS sessions,
             COUNT(per.talk_share)::int AS talk_share_sessions,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY per.talk_share) AS talk_p25,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY per.talk_share) AS talk_median,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY per.talk_share) AS talk_p75,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY per.learner_turns) AS turns_median,
             COUNT(*) FILTER (WHERE per.learner_turns >= $4
                                AND per.duration_ms >= $5
                                AND per.learner_chars >= $6)::int AS practice_sessions,
             COUNT(*) FILTER (WHERE per.learner_turns < $4)::int AS short_turn_sessions
        FROM per
       GROUP BY GROUPING SETS ((per.bucket), ())
       ORDER BY is_total, per.bucket
      `,
      params,
    );

    return rows.map((r: any) => ({
      bucket: Number(r.is_total) === 1 ? null : String(r.bucket),
      sessions: Number(r.sessions) || 0,
      talkShareSessions: Number(r.talk_share_sessions) || 0,
      talkShareP25: num(r.talk_p25),
      talkShareMedian: num(r.talk_median),
      talkShareP75: num(r.talk_p75),
      learnerTurnsMedian: num(r.turns_median),
      practiceSessions: Number(r.practice_sessions) || 0,
      shortTurnSessions: Number(r.short_turn_sessions) || 0,
    }));
  }
}
