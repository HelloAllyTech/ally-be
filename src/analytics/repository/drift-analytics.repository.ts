import { Injectable } from '@nestjs/common';
import { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { AnalyticsBucket } from './platform-analytics.repository';
import { excludeTestTenants } from '../util/test-tenant.util';

/** Shared filters for conversation-drift analytics queries. */
export interface DriftFilters {
  start: Date;
  end: Date;
  language?: string;
  scenarioId?: number;
  scenarioVersionId?: string;
  llmModel?: string;
  llmProvider?: string;
  promptVersion?: string;
}

export interface DriftRateRow {
  language: string;
  totalSessions: number;
  driftedSessions: number;
}

/** Drift rate grouped by an experiment dimension (model / prompt / STT model). */
export interface DriftDimensionRow {
  key: string;
  totalSessions: number;
  driftedSessions: number;
}

export interface DriftCountRow {
  /** category value (topic / coherence / attribution / failure / STT). */
  key: string;
  /** number of distinct sessions that had >=1 turn in this category. */
  count: number;
}

/**
 * Read-side aggregations over `turn_drift_judgment` for the conversation-drift
 * dashboard. Split out from {@link PlatformAnalyticsRepository} (which owns
 * overview + latency) so each file stays focused. Every method routes through
 * {@link applyDriftFilters}, so a new shared filter (e.g. language) applies to
 * all drift charts at once.
 */
@Injectable()
export class DriftAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): 'day' | 'week' | 'month' {
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    return 'week';
  }

  /**
   * Apply the shared drift filters (time window on the session time +
   * experiment slice dimensions) to a raw query on turn_drift_judgment aliased
   * 'j'. Time uses COALESCE(occurredAt, createdAt): occurredAt is the session
   * timestamp set by the runner; createdAt is the fallback for rows judged
   * before occurredAt was populated.
   */
  private applyDriftFilters(
    qb: SelectQueryBuilder<ObjectLiteral>,
    f: DriftFilters,
  ) {
    // Window on the SESSION's time (occurredAt), not the judgment's createdAt —
    // otherwise a backfill (which judges historic sessions today) would stamp
    // them all as "now" and pile them into the wrong date bucket. occurredAt is
    // populated by the runner from the session timestamp; COALESCE keeps older
    // rows (judged before occurredAt was set) working off createdAt.
    qb.where('COALESCE(j."occurredAt", j."createdAt") >= :start', {
      start: f.start,
    }).andWhere('COALESCE(j."occurredAt", j."createdAt") < :end', {
      end: f.end,
    });
    // Test orgs are excluded from all analytics. j."tenant_id" is a faithful
    // copy of the session's, so filter directly rather than joining sessions.
    qb.andWhere(excludeTestTenants('j."tenant_id"'));
    if (f.language)
      qb.andWhere('j."language" = :language', { language: f.language });
    if (f.scenarioId != null)
      qb.andWhere('j."scenarioId" = :scenarioId', { scenarioId: f.scenarioId });
    if (f.scenarioVersionId)
      qb.andWhere('j."scenarioVersionId" = :scenarioVersionId', {
        scenarioVersionId: f.scenarioVersionId,
      });
    if (f.llmModel)
      qb.andWhere('j."llmModel" = :llmModel', { llmModel: f.llmModel });
    if (f.llmProvider)
      qb.andWhere('j."llmProvider" = :provider', { provider: f.llmProvider });
    if (f.promptVersion)
      qb.andWhere('j."promptVersion" = :pv', { pv: f.promptVersion });
    return qb;
  }

  /** Drifted vs total sessions per language (the primary drift KPI). */
  async getDriftRateByLanguage(f: DriftFilters): Promise<DriftRateRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."language"', 'language')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .groupBy('j."language"')
      .orderBy('j."language"', 'ASC')
      .getRawMany<{
        language: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      language: r.language ?? 'unknown',
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
    }));
  }

  /**
   * Drifted vs total sessions grouped by an experiment dimension — the LLM
   * model, main-agent prompt, or STT model behind the session (all can
   * contribute to drift). `dimension` is whitelisted.
   *
   * - llmModel: the model id captured/denormalized on the judgment.
   * - promptVersion: the main-agent prompt the session ran, shown by its human
   *   NAME (+ version) rather than a bare version number. There are several
   *   main-agent prompts (each a `prompts` row with its own name); the session
   *   records `{promptCode: version}` in `metadata.promptVersions`, so we pick
   *   the main-agent code and join `prompts` for its name. Resolved at query
   *   time (no extra column / re-judge needed — works on existing rows).
   * - sttModel: the STT model the session's language is configured to use,
   *   joined from `languages.sttProviderConfig` (we don't capture the runtime
   *   STT model per turn, so this is the configured model).
   * - scenarioVersion: the scenario_versions row the session ran against, shown
   *   by its human NAME (+ version number). Denormalized onto the judgment at
   *   write time, joined to `scenario_versions` here for the label. Meant to be
   *   used with a `scenarioId` filter so versions of ONE scenario are compared
   *   (bare "v1" labels would otherwise collide across scenarios).
   *
   * Sessions with no captured/identifiable value are EXCLUDED ('unknown' isn't
   * a real model/prompt/version, so it shouldn't be charted as one).
   */
  async getDriftRateByDimension(
    f: DriftFilters,
    dimension: 'llmModel' | 'promptVersion' | 'sttModel' | 'scenarioVersion',
  ): Promise<DriftDimensionRow[]> {
    const keyExpr =
      dimension === 'sttModel'
        ? `lang."sttProviderConfig"->'config'->>'model'`
        : dimension === 'promptVersion'
          ? `pinfo.label`
          : dimension === 'scenarioVersion'
            ? `COALESCE(NULLIF(sv.name, '') || ' · v' || sv."versionNumber"::text, 'v' || sv."versionNumber"::text)`
            : `j."llmModel"`;
    const qb = this.dataSource
      .createQueryBuilder()
      .select(keyExpr, 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j');
    if (dimension === 'sttModel') {
      // Session's language -> its configured STT model. Inner join drops
      // sessions whose language has no STT config (so no 'unknown' bucket).
      qb.innerJoin('languages', 'lang', 'lang.value = j."language"');
    } else if (dimension === 'promptVersion') {
      // Resolve the main-agent prompt NAME (+ version) the session ran, plus the
      // effective language variant (GENERIC vs MULTILINGUAL) so the two are
      // separately comparable in the drift chart (the whole point of the
      // per-language experiment). Per session, pick the code as:
      //   1) metadata.selectedMainPromptCode (the actually-selected prompt), else
      //   2) the first main_agent/base_role key in metadata.promptVersions
      //      (older sessions predating selectedMainPromptCode capture).
      // Variant comes from metadata.mainPromptVariant (default GENERIC for older
      // sessions). CROSS JOIN LATERAL yields one row/session; the jsonb_typeof
      // guard avoids jsonb_object_keys erroring on non-objects; INNER JOIN
      // prompts drops unidentifiable codes (no 'unknown' bucket).
      qb.innerJoin(
        `(SELECT s.id AS sid,
                 pr.name
                   || ' (v' || COALESCE(s.metadata->'promptVersions'->>mc.code, '?') || ')'
                   || ' · ' || COALESCE(NULLIF(s.metadata->>'mainPromptVariant', ''), 'GENERIC') AS label
            FROM scenario_sessions s
            CROSS JOIN LATERAL (
              SELECT COALESCE(
                       NULLIF(s.metadata->>'selectedMainPromptCode', ''),
                       (SELECT k
                          FROM jsonb_object_keys(
                                 CASE WHEN jsonb_typeof(s.metadata->'promptVersions') = 'object'
                                      THEN s.metadata->'promptVersions' ELSE '{}'::jsonb END) k
                         WHERE k ILIKE '%main_agent%' OR k ILIKE '%base_role%'
                         ORDER BY k
                         LIMIT 1)
                     ) AS code
            ) mc
            JOIN prompts pr ON pr."promptCode" = mc.code)`,
        'pinfo',
        'pinfo.sid = j."scenarioSessionId"',
      );
    } else if (dimension === 'scenarioVersion') {
      // Resolve the version label from the denormalized id. Inner join drops
      // sessions with no scenarioVersionId (e.g. pre-versioning sessions), so
      // they aren't charted as an 'unknown' version.
      qb.innerJoin('scenario_versions', 'sv', 'sv.id = j."scenarioVersionId"');
    }
    this.applyDriftFilters(qb, f);
    qb.andWhere(`${keyExpr} IS NOT NULL`).andWhere(`${keyExpr} <> ''`);
    const rows = await qb
      .groupBy('key')
      .orderBy('"driftedSessions"', 'DESC')
      .getRawMany<{
        key: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      key: r.key ?? 'unknown',
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
    }));
  }

  /**
   * Sessions by root attribution (STT vs LLM vs cascade vs context). With
   * `driftedOnly`, restricts to sessions the rollup flagged as drifted — the
   * correct scope for "what caused the drift", so it agrees with the drift KPI.
   */
  async getDriftAttributionMix(
    f: DriftFilters,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."rootAttribution"', 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    const rows = await qb
      .andWhere('j."rootAttribution" IS NOT NULL')
      .andWhere(`j."rootAttribution" <> 'none'`)
      .groupBy('j."rootAttribution"')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Sessions with >=1 turn of each AI failure mode (what specifically broke).
   * `driftedOnly` restricts to drifted sessions (consistent with the KPI).
   */
  async getDriftFailureModeBreakdown(
    f: DriftFilters,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."aiReplyFailureMode"', 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    const rows = await qb
      .andWhere('j."aiReplyFailureMode" IS NOT NULL')
      .andWhere(`j."aiReplyFailureMode" <> 'none'`)
      .groupBy('j."aiReplyFailureMode"')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Generic drift-turn counts grouped by a whitelisted per-turn dimension:
   * topic label (on/tangent/off/gibberish), coherence level, STT garble
   * severity (none/partial/severe), or STT error type. `excludeNone` drops the
   * 'none' bucket — used for sttErrorType (where 'none' = "not garbled" and
   * isn't informative); kept for garble severity, where none/partial/severe is
   * the whole point. `driftedOnly` restricts to drifted sessions.
   */
  async getDriftSessionCountsBy(
    f: DriftFilters,
    dimension:
      | 'topicLabel'
      | 'coherence'
      | 'counselorUtteranceGarbled'
      | 'sttErrorType',
    excludeNone = false,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const col = {
      topicLabel: 'topicLabel',
      coherence: 'coherence',
      counselorUtteranceGarbled: 'counselorUtteranceGarbled',
      sttErrorType: 'sttErrorType',
    }[dimension];
    const qb = this.dataSource
      .createQueryBuilder()
      .select(`j."${col}"`, 'key')
      // Distinct sessions touched by each category. Sessions can span multiple
      // categories (different turns), so these counts overlap and don't sum to
      // total sessions — render as bars, not a pie.
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    // Drift KINDS (topic/coherence) describe drifted sessions, so scope to the
    // rollup. STT input-quality (garble/error-type) is independent of drift and
    // is queried with driftedOnly=false.
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    qb.andWhere(`j."${col}" IS NOT NULL`);
    if (excludeNone) qb.andWhere(`j."${col}" <> 'none'`);
    const rows = await qb
      .groupBy(`j."${col}"`)
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Distribution of the turn at which drift first began, across drifted
   * sessions ("after the nth utterance"). One count per session (firstDriftTurn
   * is the rollup, denormalized onto every turn row, so DISTINCT session).
   */
  async getFirstDriftTurnHistogram(
    f: DriftFilters,
  ): Promise<{ turn: number; sessions: number }[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."firstDriftTurn"', 'turn')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'sessions')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .andWhere('j."sessionDrifted" = true')
      .andWhere('j."firstDriftTurn" IS NOT NULL')
      .groupBy('j."firstDriftTurn"')
      .orderBy('j."firstDriftTurn"', 'ASC')
      .getRawMany<{ turn: number; sessions: number }>();
    return rows.map((r) => ({
      turn: Number(r.turn),
      sessions: Number(r.sessions) || 0,
    }));
  }

  /**
   * Drift rate over time — drifted vs total sessions per day/week/month bucket
   * on the session time (COALESCE occurredAt/createdAt), split by source
   * ('pipeline' = live vs 'transcript' = historical). The "is drift getting
   * better?" trend.
   */
  async getDriftTrend(
    f: DriftFilters,
    bucket: AnalyticsBucket,
  ): Promise<
    {
      bucket: string;
      source: string;
      totalSessions: number;
      driftedSessions: number;
    }[]
  > {
    const trunc = this.resolveBucket(bucket);
    // Split each bucket by the session's source — 'pipeline' (live agent runs)
    // vs 'transcript' (historical/reconstructed) — derived from its turn
    // metrics, mirroring the voice-latency chart. No column on the judgment;
    // joined per session so it works on existing rows without a re-judge.
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(j."occurredAt", j."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('ssrc.source', 'source')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j')
      // INNER join (+ NOT NULL below): a session with no recorded source can't
      // be Live or Historical, so it's excluded rather than charted as a
      // misleading 'unknown' series.
      .innerJoin(
        `(SELECT "scenarioSessionId" AS sid,
                 mode() WITHIN GROUP (ORDER BY source) AS source
            FROM scenario_session_turn_metrics
           WHERE source IS NOT NULL
           GROUP BY "scenarioSessionId")`,
        'ssrc',
        'ssrc.sid = j."scenarioSessionId"',
      );
    this.applyDriftFilters(qb, f);
    qb.andWhere('ssrc.source IS NOT NULL');
    const rows = await qb
      .groupBy('bucket')
      .addGroupBy('source')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        source: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      bucket: r.bucket,
      source: r.source ?? 'unknown',
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
    }));
  }
}
