import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Back-fills `language` on historical `scenario_session_turn_metrics` /
 * `scenario_session_start_metrics` rows. Both columns exist but were only ever
 * set from whatever the ally-ai-learn runtime happened to include in its SQS
 * payload — there was no fallback to the owning session's own configured
 * language, so most rows ended up NULL (unlike e.g. `scenarioId`, which already
 * falls back to the session at write time). ScenarioSessionService now fills
 * this in going forward (see addTurnMetrics/addStartMetrics); this migration
 * catches up the existing rows using the exact same resolution every read-time
 * language join already uses elsewhere (analytics, drift, session logs):
 * `scenario_sessions.metadata->>'languageId'` -> `languages.value`, defaulting
 * to 'en' when unset/unresolvable.
 *
 * Idempotent (NULL-guarded — safe to re-run); down() is a no-op because a
 * NULL-fill backfill can't be distinguished from a value set legitimately.
 */
export class BackfillTurnMetricsLanguage1868000000000 implements MigrationInterface {
  name = 'BackfillTurnMetricsLanguage1868000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenario_session_turn_metrics" m
          SET "language" = COALESCE(l."value", 'en')
         FROM "scenario_sessions" s
         LEFT JOIN "languages" l
           ON l.id = NULLIF(s.metadata->>'languageId', '')::int
        WHERE s.id = m."scenarioSessionId"
          AND m."language" IS NULL`,
    );

    await queryRunner.query(
      `UPDATE "scenario_session_start_metrics" m
          SET "language" = COALESCE(l."value", 'en')
         FROM "scenario_sessions" s
         LEFT JOIN "languages" l
           ON l.id = NULLIF(s.metadata->>'languageId', '')::int
        WHERE s.id = m."scenarioSessionId"
          AND m."language" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    // Intentional no-op: a NULL-fill backfill can't be safely reversed without
    // also clearing rows that were populated legitimately at write time.
  }
}
