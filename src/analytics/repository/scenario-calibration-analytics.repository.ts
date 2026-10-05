import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE,
  BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE,
} from 'src/learn/constants/scenario-behavior-instuctions.constants';
import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { resolveSqlBucket } from '../util/analytics-window.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { resolvedSessionScorePredicate } from '../util/scenario-effectiveness.util';
import { ScoringContributor } from '../util/scenario-score-range.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/** One countable, scored session of a scenario version. */
export interface CalibrationSessionRow {
  scenarioId: number;
  /** scenario_sessions.scenarioVersionId; null for sessions that recorded none. */
  versionId: string | null;
  versionNumber: number | null;
  title: string | null;
  difficultyLevel: string | null;
  score: number;
  /** COALESCE(startedAt, createdAt) — compared against the config-change time. */
  startedAt: Date;
  /** False for the unresolved 0 (no detected event) — excluded, but counted. */
  resolved: boolean;
}

/** One live scoring contributor of a scenario. */
export interface ScoringContributorRow extends ScoringContributor {
  scenarioId: number;
}

/** When a scenario's scoring config last changed (null: nothing on record). */
export interface ScoringConfigChangeRow {
  scenarioId: number;
  changedAt: Date | null;
}

/**
 * One progression "shape" — the per-session state summary — with how many
 * countable sessions in the bucket and scenario share it. Grouping on the shape
 * keeps the result small; the classification itself lives in TypeScript.
 */
export interface ProgressionShapeRow {
  /** Bucket start (yyyy-mm-dd) of the session's END. */
  bucket: string;
  scenarioId: number;
  title: string | null;
  /** Some turn of the session carries a `stateCount` key. */
  hasStateMetadata: boolean;
  /** MAX(stateCount) over its turns. */
  states: number | null;
  /** stateIndex of its first state-bearing turn (null: none carries one). */
  opening: number | null;
  furthest: number | null;
  lowest: number | null;
  /** Some turn reported `stateIsTerminal: true`. */
  reachedEnd: boolean;
  sessions: number;
}

/** A jsonb key read as a number only when it is one (or a numeric string). */
const jsonNumber = (expr: string, key: string): string =>
  `CASE WHEN (${expr}->>'${key}') ~ '^-?[0-9]+(\\.[0-9]+)?$' ` +
  `THEN (${expr}->>'${key}')::float END`;

/** A jsonb key read as a boolean only when it is one. */
const jsonBoolean = (expr: string, key: string): string =>
  `CASE WHEN jsonb_typeof(${expr}->'${key}') = 'boolean' ` +
  `THEN (${expr}->>'${key}')::boolean END`;

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Reads behind scenario difficulty calibration (AAQ-227) and state progression
 * (AAQ-228).
 *
 * Every read of `scenario_sessions` keeps to countable sessions
 * (`status = 'ENDED'`, `eventStatus = 'COMPLETED'`, no preview or seed rooms),
 * excludes test organisations and, when an org is picked, narrows by the
 * session's own tenant with the id as a BOUND parameter.
 *
 * The scoring-config reads (contributors, last change) are scenario content,
 * not tenant data, so they take scenario ids only. They mirror what the worker
 * is sent at session start (`SessionEventSharedService` +
 * `formatBehaviorInstructionsForLivekitMetadata`): ACTIVE base events mapped by
 * a live `scenario_events` row, every PASSIVE base event, and the scenario's
 * live behaviour instructions.
 */
@Injectable()
export class ScenarioCalibrationAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The countable-session predicate on alias `s`, with the org bound to `placeholder`. */
  private sessionScope(placeholder: string, tenantId?: string): string {
    const base =
      `s.status = '${ScenarioSessionStatus.ENDED}' ` +
      `AND s."eventStatus" = '${ScenarioSessionEventStatus.COMPLETED}' ` +
      `AND ${countableSessionPredicate('s')} ` +
      `AND ${excludeTestTenants('s."tenant_id"')}`;
    return tenantId
      ? `${base} AND ${scopeToTenant('s."tenant_id"', placeholder)}`
      : base;
  }

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Interpolated into date_trunc — whitelist, never pass anything through.
    return resolveSqlBucket(
      bucket,
      ['day', 'week', 'month', 'quarter', 'year'],
      'month',
    );
  }

  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /* ------------------------------------------------------------------------ */
  /* Calibration                                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Every countable session with a score, all time, with its scenario version,
   * the scenario's title and authored difficulty, and whether the score is
   * resolved. The unresolved 0 (no detected event) comes back flagged rather
   * than filtered so the response can count what it dropped; the rule is the
   * one repeat improvement uses (`resolvedSessionScorePredicate`).
   */
  async getCalibrationSessions(
    tenantId?: string,
  ): Promise<CalibrationSessionRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT s."scenarioId" AS scenario_id,
             s."scenarioVersionId" AS version_id,
             v."versionNumber" AS version_number,
             sc.title,
             sc."difficultyLevel" AS difficulty_level,
             s.score::float AS score,
             COALESCE(s."startedAt", s."createdAt") AS started_at,
             (${resolvedSessionScorePredicate('s')}) AS resolved
        FROM scenario_sessions s
        LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
        LEFT JOIN scenario_versions v ON v.id = s."scenarioVersionId"
       WHERE ${this.sessionScope('$1', tenantId)}
         AND s.score IS NOT NULL
      `,
      tenantId ? [tenantId] : [],
    );
    return rows.map((r: any) => ({
      scenarioId: Number(r.scenario_id),
      versionId: (r.version_id as string | null) ?? null,
      versionNumber: toNum(r.version_number),
      title: (r.title as string | null) ?? null,
      difficultyLevel: (r.difficulty_level as string | null) ?? null,
      score: Number(r.score),
      startedAt: toDate(r.started_at) ?? new Date(0),
      resolved: r.resolved === true || r.resolved === 't',
    }));
  }

  /**
   * The live scoring contributors of each scenario in `scenarioIds`:
   *
   *  - ACTIVE base events mapped by a live, non-termination `scenario_events`
   *    row: score `COALESCE(mapping, base)`, cap from the mapping's
   *    `detectionConfig.maxOccurrences`;
   *  - every live PASSIVE base event (the worker is sent them for every
   *    scenario): the scenario's own mapping score/cap when it has one, else
   *    the base score, uncapped;
   *  - live behaviour instructions: SHOULD_DO +10, SHOULD_NOT_DO −10, uncapped.
   *
   * Contributors with no score come back too; the range derivation skips them.
   */
  async getScoringContributors(
    scenarioIds: readonly number[],
  ): Promise<ScoringContributorRow[]> {
    if (scenarioIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `
      SELECT se."scenarioId" AS scenario_id,
             'event' AS kind,
             COALESCE(se.score, ev.score)::float AS score,
             ${jsonNumber('se."detectionConfig"', 'maxOccurrences')} AS max_occurrences
        FROM scenario_events se
        JOIN session_events ev ON ev.id = se."eventId"
       WHERE se."scenarioId" = ANY($1::int[])
         AND se."deletedAt" IS NULL
         AND se."autoTerminationStatus" = false
         AND ev."deletedAt" IS NULL
         AND ev."visibilityType" = '${SessionEventVisibilityType.ACTIVE}'
      UNION ALL
      SELECT sc.scenario_id,
             'event' AS kind,
             COALESCE(se.score, ev.score)::float AS score,
             ${jsonNumber('se."detectionConfig"', 'maxOccurrences')} AS max_occurrences
        FROM (SELECT DISTINCT unnest($1::int[]) AS scenario_id) sc
       CROSS JOIN session_events ev
        LEFT JOIN scenario_events se
          ON se."eventId" = ev.id
         AND se."scenarioId" = sc.scenario_id
         AND se."deletedAt" IS NULL
         AND se."autoTerminationStatus" = false
       WHERE ev."deletedAt" IS NULL
         AND ev."visibilityType" = '${SessionEventVisibilityType.PASSIVE}'
      UNION ALL
      SELECT bi."scenarioId" AS scenario_id,
             'behaviour' AS kind,
             (CASE WHEN bi.category = '${BehaviorInstructionCategory.SHOULD_DO}'
                   THEN ${BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE}
                   ELSE ${BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE} END)::float AS score,
             NULL::float AS max_occurrences
        FROM scenario_behavior_instructions bi
       WHERE bi."scenarioId" = ANY($1::int[])
         AND bi."deletedAt" IS NULL
      `,
      [scenarioIds],
    );
    return rows.map((r: any) => ({
      scenarioId: Number(r.scenario_id),
      kind: r.kind === 'behaviour' ? 'behaviour' : 'event',
      score: toNum(r.score),
      maxOccurrences: toNum(r.max_occurrences),
    }));
  }

  /**
   * When each scenario's scoring config last changed: the latest create,
   * update or soft-delete of one of its non-termination event mappings, of the
   * base event behind a mapping that falls back to the base score, of one of
   * its behaviour instructions, or of any PASSIVE base event (those apply to
   * every scenario). Deliberately over-eager — an edit that did not touch a
   * score still moves it — because the cost of that is a raw fallback, where
   * the cost of under-reporting is bands that mix two scoring configs.
   * Hard-deleted mappings (`deleteScenarioEvents` deletes rows) leave no trace.
   */
  async getScoringConfigChangedAt(
    scenarioIds: readonly number[],
  ): Promise<ScoringConfigChangeRow[]> {
    if (scenarioIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `
      WITH sc AS (SELECT DISTINCT unnest($1::int[]) AS scenario_id),
      passive AS (
        SELECT MAX(GREATEST(ev."createdAt", ev."updatedAt", ev."deletedAt")) AS changed_at
          FROM session_events ev
         WHERE ev."visibilityType" = '${SessionEventVisibilityType.PASSIVE}'
      )
      SELECT sc.scenario_id,
             GREATEST(
               (SELECT MAX(GREATEST(se."createdAt", se."updatedAt", se."deletedAt"))
                  FROM scenario_events se
                 WHERE se."scenarioId" = sc.scenario_id
                   AND se."autoTerminationStatus" = false),
               (SELECT MAX(GREATEST(ev."createdAt", ev."updatedAt", ev."deletedAt"))
                  FROM scenario_events se
                  JOIN session_events ev ON ev.id = se."eventId"
                 WHERE se."scenarioId" = sc.scenario_id
                   AND se."deletedAt" IS NULL
                   AND se."autoTerminationStatus" = false
                   AND se.score IS NULL),
               (SELECT MAX(GREATEST(bi."createdAt", bi."updatedAt", bi."deletedAt"))
                  FROM scenario_behavior_instructions bi
                 WHERE bi."scenarioId" = sc.scenario_id),
               (SELECT changed_at FROM passive)
             ) AS changed_at
        FROM sc
      `,
      [scenarioIds],
    );
    return rows.map((r: any) => ({
      scenarioId: Number(r.scenario_id),
      changedAt: toDate(r.changed_at),
    }));
  }

  /* ------------------------------------------------------------------------ */
  /* Progression                                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Per countable session ENDED in [start, end): the summary of the
   * simulation state its turns ran in, grouped by (bucket, scenario, shape).
   *
   * This is the "Progression through simulation states" cookbook query
   * (`docs/weak-metrics-queries.md`), joined to countable sessions and bucketed
   * by session end instead of turn time. Keys are the ones ally-ai-learn
   * stamps per turn (`app/core/graph/nodes.py`): `stateCount` whenever the
   * scenario has states, `stateIndex`/`stateIsTerminal` only when a scored
   * state resolved (branching mode writes `stateId: null` and no index).
   * Sessions with no state-bearing turn come back with
   * `hasStateMetadata: false` so they can be counted as untracked.
   */
  async getProgressionShapes(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<ProgressionShapeRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource.query(
      `
      WITH sess AS (
        SELECT s.id, s."scenarioId" AS scenario_id,
               to_char(date_trunc('${trunc}', s."endedAt"), 'YYYY-MM-DD') AS bucket
          FROM scenario_sessions s
         WHERE ${this.sessionScope('$3', tenantId)}
           AND s."endedAt" >= $1
           AND s."endedAt" < $2
      ),
      t AS (
        SELECT tm."scenarioSessionId" AS sid,
               tm."turnIndex" AS idx,
               ${jsonNumber('tm.metadata', 'stateIndex')} AS state_idx,
               ${jsonNumber('tm.metadata', 'stateCount')} AS state_count,
               ${jsonBoolean('tm.metadata', 'stateIsTerminal')} AS terminal
          FROM scenario_session_turn_metrics tm
          JOIN sess ON sess.id = tm."scenarioSessionId"
         WHERE tm.metadata ? 'stateCount'
      ),
      per AS (
        SELECT sid,
               MAX(state_count) AS states,
               (array_agg(state_idx ORDER BY idx) FILTER (WHERE state_idx IS NOT NULL))[1] AS opening,
               MAX(state_idx) AS furthest,
               MIN(state_idx) AS lowest,
               COALESCE(BOOL_OR(terminal), false) AS reached_end
          FROM t
         GROUP BY sid
      )
      SELECT sess.bucket,
             sess.scenario_id,
             sc.title,
             (per.sid IS NOT NULL) AS has_state_metadata,
             per.states,
             per.opening,
             per.furthest,
             per.lowest,
             COALESCE(per.reached_end, false) AS reached_end,
             COUNT(*)::int AS sessions
        FROM sess
        LEFT JOIN per ON per.sid = sess.id
        LEFT JOIN scenarios sc ON sc.id = sess.scenario_id
       GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
       ORDER BY 1, 2
      `,
      tenantId ? [start, end, tenantId] : [start, end],
    );
    return rows.map((r: any) => ({
      bucket: String(r.bucket),
      scenarioId: Number(r.scenario_id),
      title: (r.title as string | null) ?? null,
      hasStateMetadata:
        r.has_state_metadata === true || r.has_state_metadata === 't',
      states: toNum(r.states),
      opening: toNum(r.opening),
      furthest: toNum(r.furthest),
      lowest: toNum(r.lowest),
      reachedEnd: r.reached_end === true || r.reached_end === 't',
      sessions: Number(r.sessions) || 0,
    }));
  }
}
