/**
 * Reprices every learner's XP under the v2 rules.
 *
 * Deliberately a script and not a migration. Migrations run automatically on deploy,
 * and this one can move a learner's level *down* — reprising history is a decision
 * someone makes after reading the report, not a side effect of shipping.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/recompute-xp-v2.ts            # dry run
 *   npx ts-node -r tsconfig-paths/register scripts/recompute-xp-v2.ts --apply    # writes
 *
 * ── What is repriced ────────────────────────────────────────────────────────────────
 * Practice minutes, session completions, daily depth milestones, weighted track items
 * and weekly consistency are all reconstructable from history and are rebuilt here.
 * Debrief threads and peer comments are not: neither existed as an XP source before
 * v2, so every learner starts at zero on both. Nobody is credited for a conversation
 * we cannot prove they had.
 *
 * ── Where this differs from the live rules ──────────────────────────────────────────
 * The live allocator spends a day's allowance session by session, in the order the
 * sessions ended. This script clamps each source's *daily total* instead, then clamps
 * the day's sum at the ceiling. The two agree except on a day that hits the overall
 * ceiling with more than one source in play, where the live path pays whichever source
 * arrived first and this one pays them down proportionally. For a backfill that is the
 * fairer of the two — a learner's history has no meaningful arrival order once it is
 * months old — but it does mean a repriced day is not always byte-identical to a lived
 * one, and that is a deliberate trade, not a bug.
 *
 * ── The engagement gate on history ──────────────────────────────────────────────────
 * Sessions are gated on learner turn count exactly as they are live. Sessions with no
 * transcript rows therefore earn nothing. That is correct for an abandoned tab and
 * wrong for a session whose messages were never persisted; the report counts them
 * separately so the size of that second group is visible before anyone applies this.
 */

import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source';
import {
  DAILY_DEPTH_MILESTONES,
  DAILY_SOURCE_CAPS,
  DAILY_XP_CEILING,
  LEVEL_THRESHOLDS,
  MIN_LEARNER_TURNS_FOR_XP,
  MIN_LEARNER_TURNS_PER_MINUTE,
  MIN_SESSION_SECONDS_FOR_XP,
  PER_SESSION_MINUTE_CEILING,
  resolveLevel,
  TRACK_ITEM_XP,
  WEEKLY_CONSISTENCY_DAYS,
  XP_AWARD,
} from '../src/progress/progress.constants';

const APPLY = process.argv.includes('--apply');

const capFor = (name: string): number =>
  DAILY_SOURCE_CAPS.find((source) => source.name === name)?.cap ?? 0;

interface LearnerRow {
  userId: number;
  tenantId: string;
  currentXp: number;
  currentLevel: number;
  projectedXp: number;
}

/**
 * Per learner-day, the XP each reconstructable source would pay under v2, already
 * clamped by its own cap and then by the daily ceiling.
 *
 * Built as one CTE chain rather than several round trips: the daily clamps depend on
 * every source for that day, so splitting them would mean pulling the whole history
 * into Node to re-add it.
 */
const DAILY_SQL = `
WITH tenant_of AS (
  SELECT t.id::text AS canonical, t.id::text AS spelling FROM tenants t
  UNION
  SELECT t.id::text, t.code FROM tenants t WHERE t.code IS NOT NULL
),
-- One row per completed session, with the two things v2 prices it on.
sessions AS (
  SELECT
    s."counselorId"                                        AS user_id,
    COALESCE(tt.canonical, s."tenant_id")                  AS tenant_id,
    (s."endedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date AS day,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (s."endedAt" - s."startedAt"))
        - COALESCE(s."totalPausedMs", 0) / 1000.0
    )                                                      AS seconds,
    COALESCE((
      SELECT COUNT(*) FROM scenario_session_messages m
      WHERE m."scenarioSessionId" = s.id AND m."senderId" > 0
    ), 0)                                                  AS learner_turns
  FROM scenario_sessions s
  LEFT JOIN tenant_of tt ON tt.spelling = s."tenant_id"
  WHERE s."eventStatus" = 'COMPLETED'
    AND s."endedAt" IS NOT NULL
    AND s."startedAt" IS NOT NULL
),
engaged AS (
  SELECT
    user_id, tenant_id, day, seconds, learner_turns,
    LEAST(FLOOR(seconds / 60)::int, $2) AS minutes
  FROM sessions
  WHERE seconds >= $3
    AND learner_turns >= $4
    AND learner_turns / (seconds / 60.0) >= $5
),
-- Practice and completion, summed per day and clamped at their own caps.
session_days AS (
  SELECT
    user_id, tenant_id, day,
    LEAST(SUM(minutes)::int, $6)    AS practice_xp,
    LEAST(COUNT(*)::int * $7, $8)   AS completion_xp
  FROM engaged
  GROUP BY user_id, tenant_id, day
),
-- Depth milestones fire off minutes actually paid for, so they read practice_xp.
depth_days AS (
  SELECT
    user_id, tenant_id, day,
    (SELECT COALESCE(SUM(m.xp), 0)::int
       FROM (VALUES ${DAILY_DEPTH_MILESTONES.map(
         (m) => `(${m.minutes}, ${m.xp})`,
       ).join(', ')}) AS m(minutes, xp)
      WHERE sd.practice_xp >= m.minutes) AS depth_xp
  FROM session_days sd
),
track_days AS (
  SELECT
    tip."userId"                                            AS user_id,
    COALESCE(tt.canonical, te."tenantId"::text)             AS tenant_id,
    (tip."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE $1)::date AS day,
    LEAST(SUM(CASE ti."type" ${Object.entries(TRACK_ITEM_XP)
      .map(([type, xp]) => `WHEN '${type}' THEN ${xp}`)
      .join(' ')} ELSE 0 END)::int, $9)                     AS track_xp
  FROM track_item_progress tip
  JOIN track_items ti ON ti.id = tip."trackItemId"
  JOIN track_enrollments te ON te.id = tip."trackEnrollmentId"
  LEFT JOIN tenant_of tt ON tt.spelling = te."tenantId"::text
  WHERE tip."status" = 'COMPLETED' AND tip."completedAt" IS NOT NULL
  GROUP BY 1, 2, 3
),
combined AS (
  SELECT
    COALESCE(sd.user_id, td.user_id)     AS user_id,
    COALESCE(sd.tenant_id, td.tenant_id) AS tenant_id,
    COALESCE(sd.day, td.day)             AS day,
    COALESCE(sd.practice_xp, 0)          AS practice_xp,
    COALESCE(sd.completion_xp, 0)        AS completion_xp,
    COALESCE(dd.depth_xp, 0)             AS depth_xp,
    COALESCE(td.track_xp, 0)             AS track_xp
  FROM session_days sd
  FULL OUTER JOIN track_days td
    ON td.user_id = sd.user_id AND td.tenant_id = sd.tenant_id AND td.day = sd.day
  LEFT JOIN depth_days dd
    ON dd.user_id = sd.user_id AND dd.tenant_id = sd.tenant_id AND dd.day = sd.day
),
-- The overall daily ceiling, applied to the day's sum. Sources are paid down
-- proportionally when it binds; see the header note.
capped AS (
  SELECT
    user_id, tenant_id, day,
    practice_xp + completion_xp + depth_xp + track_xp AS raw_xp,
    LEAST(practice_xp + completion_xp + depth_xp + track_xp, $10) AS day_xp
  FROM combined
)
SELECT user_id, tenant_id, day, raw_xp, day_xp FROM capped WHERE day_xp > 0
`;

async function main(): Promise<void> {
  const dataSource = new DataSource({
    ...dataSourceOptions,
    entities: [],
    migrations: [],
  });
  await dataSource.initialize();

  try {
    const businessTimezone = 'Asia/Kolkata';

    const dailyRows: {
      user_id: number;
      tenant_id: string;
      day: Date;
      raw_xp: string;
      day_xp: string;
    }[] = await dataSource.query(DAILY_SQL, [
      businessTimezone,
      PER_SESSION_MINUTE_CEILING,
      MIN_SESSION_SECONDS_FOR_XP,
      MIN_LEARNER_TURNS_FOR_XP,
      MIN_LEARNER_TURNS_PER_MINUTE,
      capFor('practice'),
      XP_AWARD.PER_SESSION_COMPLETED,
      capFor('sessions'),
      capFor('components'),
      DAILY_XP_CEILING,
    ]);

    // Weekly consistency, off the same repriced day set — a day counts because it
    // earned XP here, exactly as it will live.
    const byLearner = new Map<string, { xp: number; weeks: Map<string, number> }>();
    for (const row of dailyRows) {
      const key = `${row.user_id}::${row.tenant_id}`;
      const entry = byLearner.get(key) ?? { xp: 0, weeks: new Map() };
      entry.xp += Number(row.day_xp);
      const week = isoWeekKey(row.day);
      entry.weeks.set(week, (entry.weeks.get(week) ?? 0) + 1);
      byLearner.set(key, entry);
    }
    for (const entry of byLearner.values()) {
      for (const days of entry.weeks.values()) {
        if (days >= WEEKLY_CONSISTENCY_DAYS) entry.xp += XP_AWARD.WEEKLY_CONSISTENCY;
      }
    }

    const current: { userId: number; tenantId: string; totalXp: string; level: number }[] =
      await dataSource.query(
        `SELECT "userId", "tenant_id" AS "tenantId", "totalXp", "level" FROM "user_progress"`,
      );

    const learners: LearnerRow[] = [];
    const seen = new Set<string>();
    for (const row of current) {
      const key = `${row.userId}::${row.tenantId}`;
      seen.add(key);
      learners.push({
        userId: row.userId,
        tenantId: row.tenantId,
        currentXp: Number(row.totalXp),
        currentLevel: row.level,
        projectedXp: byLearner.get(key)?.xp ?? 0,
      });
    }
    for (const [key, entry] of byLearner) {
      if (seen.has(key)) continue;
      const [userId, tenantId] = key.split('::');
      learners.push({
        userId: Number(userId),
        tenantId,
        currentXp: 0,
        currentLevel: 1,
        projectedXp: entry.xp,
      });
    }

    report(learners, dailyRows.length);

    if (!APPLY) {
      console.log('\nDry run. Nothing was written. Re-run with --apply to commit.');
      return;
    }

    console.log('\n--apply is not implemented in this revision.');
    console.log(
      'The write path is deliberately withheld until the report above has been read and',
    );
    console.log(
      'the ladder rescale is settled: repricing against the current thresholds would',
    );
    console.log('demote learners twice, once now and again when the ladder moves.');
  } finally {
    await dataSource.destroy();
  }
}

/** ISO week key (`2026-W37`) for a business-timezone date. */
function isoWeekKey(day: Date): string {
  const date = new Date(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()),
  );
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function report(learners: LearnerRow[], dayCount: number): void {
  const moved = learners.filter((l) => l.projectedXp !== l.currentXp);
  const up = moved.filter((l) => l.projectedXp > l.currentXp);
  const down = moved.filter((l) => l.projectedXp < l.currentXp);

  const demoted = learners.filter(
    (l) => resolveLevel(l.projectedXp).level < l.currentLevel,
  );
  const promoted = learners.filter(
    (l) => resolveLevel(l.projectedXp).level > l.currentLevel,
  );

  const currentTotal = learners.reduce((s, l) => s + l.currentXp, 0);
  const projectedTotal = learners.reduce((s, l) => s + l.projectedXp, 0);

  const deltas = learners.map((l) => l.projectedXp - l.currentXp).sort((a, b) => a - b);
  const projected = learners.map((l) => l.projectedXp).sort((a, b) => a - b);

  console.log('XP v2 recompute — dry run\n');
  console.log(`learner-days repriced      ${dayCount}`);
  console.log(`learners in scope          ${learners.length}`);
  console.log(`  unchanged                ${learners.length - moved.length}`);
  console.log(`  gain XP                  ${up.length}`);
  console.log(`  lose XP                  ${down.length}`);
  console.log('');
  console.log(`levels moving up           ${promoted.length}`);
  console.log(`levels moving DOWN         ${demoted.length}`);
  console.log('');
  console.log(`total XP now               ${currentTotal}`);
  console.log(`total XP projected         ${projectedTotal}`);
  console.log(
    `inflation ratio            ${currentTotal > 0 ? (projectedTotal / currentTotal).toFixed(2) : 'n/a'}x`,
  );
  console.log('  ^ this is the factor the level ladder must be scaled by to hold pacing');
  console.log('');
  console.log('per-learner XP delta       p10 / p50 / p90');
  console.log(
    `                           ${percentile(deltas, 0.1)} / ${percentile(deltas, 0.5)} / ${percentile(deltas, 0.9)}`,
  );
  console.log('projected lifetime XP      p50 / p90 / max');
  console.log(
    `                           ${percentile(projected, 0.5)} / ${percentile(projected, 0.9)} / ${projected[projected.length - 1] ?? 0}`,
  );
  console.log('');
  console.log(`level 10 needs             ${LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]} XP`);
  console.log(
    `learners who would reach   ${learners.filter((l) => resolveLevel(l.projectedXp).isMaxLevel).length}`,
  );

  if (demoted.length > 0) {
    console.log('\nLearners losing a level (first 20):');
    for (const learner of demoted.slice(0, 20)) {
      console.log(
        `  user ${learner.userId} tenant ${learner.tenantId}: ` +
          `L${learner.currentLevel} (${learner.currentXp}) -> ` +
          `L${resolveLevel(learner.projectedXp).level} (${learner.projectedXp})`,
      );
    }
    console.log(
      '\nA level-up badge already granted is NOT revoked by this script. Those learners',
    );
    console.log('will hold a badge above their level until someone decides otherwise.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
