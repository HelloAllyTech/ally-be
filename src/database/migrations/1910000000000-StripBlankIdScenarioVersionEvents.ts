import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data-only correction — no DDL.
 *
 * `scenario_versions.config` (jsonb) is the entire Studio form for a draft,
 * autosaved verbatim by `ScenarioVersionService.updateVersion` with no
 * per-event validation (unlike the live-scenario path, which validates every
 * event id against `session_events` before it can be saved — see
 * `ScenarioService.mapEventsToScenario`).
 *
 * The Advanced Settings events table (`SimulationEventMapTable.tsx`) inserts
 * a placeholder row with `id: ""` the instant "Add Event" is clicked, before
 * the admin picks an event from the dropdown. If an autosave tick fired in
 * that window — panel closed early, request failed, tab switched — the blank
 * row was written straight into `config.mappedEvents` and reloaded on every
 * subsequent visit to that draft. Because the "Add Event" button disables
 * itself whenever any row has a blank id (to prevent stacking placeholders),
 * a scenario that hit this once could never add another event again.
 *
 * This strips any `config.mappedEvents` entries with a missing/empty `id`
 * from every scenario version. Real events are untouched — `id` is only ever
 * blank on one of these dead placeholder rows.
 */
export class StripBlankIdScenarioVersionEvents1910000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "scenario_versions"
      SET "config" = jsonb_set(
        "config",
        '{mappedEvents}',
        COALESCE(
          (
            SELECT jsonb_agg(event)
            FROM jsonb_array_elements("config"->'mappedEvents') AS event
            WHERE event->>'id' IS NOT NULL AND event->>'id' <> ''
          ),
          '[]'::jsonb
        )
      )
      WHERE jsonb_typeof("config"->'mappedEvents') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements("config"->'mappedEvents') AS event
        WHERE event->>'id' IS NULL OR event->>'id' = ''
      )
    `);
  }

  /**
   * Deliberately a no-op. The stripped rows were dead placeholders that could
   * never publish (a blank id fails `validateMapEventsToScenario`) — there is
   * nothing worth restoring, and restoring them would put the stuck-button
   * bug back. Re-running `up` is safe: it only ever removes blank-id entries.
   */
  public async down(): Promise<void> {
    // no-op — see above
  }
}
