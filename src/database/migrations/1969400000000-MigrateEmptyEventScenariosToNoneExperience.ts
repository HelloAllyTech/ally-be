import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves every roleplay with no usable real-time event into Experience Mode
 * `NONE` with its Live Events tab off.
 *
 * WHY: `experienceMode` defaults to `FEEDBACK` (see
 * `1768823456789-addExperienceModeToScenarios`) and `liveTabEnabled` defaults
 * to `true` (opt-out) everywhere it's read. A roleplay authored before
 * Advanced Events existed, or one whose events were never wired with a
 * real-time message, inherits both defaults and shows the learner a Live
 * Events tab that can never render anything — `SimulationEvents.tsx` drops
 * any event lacking `emoji`+`message` before it ever reaches the tab. `NONE` +
 * Live Events off is the state that actually matches what the learner sees:
 * no live feed, so no tab promising one.
 *
 * A roleplay qualifies when it has zero non-deleted, non-auto-termination
 * `scenario_events` rows (`ScenarioEventsRepository.getScenarioEvents`'s own
 * definition of "advanced events"), OR it has some but not one of them is
 * capable of a real-time card (`feedbackStatus = true` and both `message` and
 * `emoji` set) — the two problem cases from the ticket collapse into one
 * `NOT EXISTS`. Scenarios already at Experience Mode `NONE` are left alone —
 * this migration only touches the mismatched FEEDBACK/CHECKLIST cohort.
 *
 * This does NOT touch `checklistType` or `summaryChecklistEnabled` — a
 * roleplay dropping out of CHECKLIST mode into NONE has no checklist to
 * preserve settings for, and those keys simply stop being read.
 */
export class MigrateEmptyEventScenariosToNoneExperience1969400000000 implements MigrationInterface {
  name = 'MigrateEmptyEventScenariosToNoneExperience1969400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "scenarios" s
      SET "metadata" = jsonb_set(
        jsonb_set(
          COALESCE(s."metadata", '{}'::jsonb),
          '{experienceMode}',
          '"NONE"'
        ),
        '{liveTabEnabled}',
        'false'
      )
      WHERE COALESCE(s."metadata" ->> 'experienceMode', 'FEEDBACK') IN ('FEEDBACK', 'CHECKLIST')
        AND NOT EXISTS (
          SELECT 1 FROM "scenario_events" se
          WHERE se."scenarioId" = s.id
            AND se."deletedAt" IS NULL
            AND se."autoTerminationStatus" = false
            AND se."feedbackStatus" = true
            AND se."message" IS NOT NULL AND se."message" != ''
            AND se."emoji" IS NOT NULL AND se."emoji" != ''
        )
    `);
  }

  /**
   * Approximate, deliberately (same shape as
   * `1944200000000-FoldEnableFeedbackIntoFeedbackTabs`'s down()): there is no
   * record of what a migrated roleplay's `experienceMode` was before this ran.
   * Only rows that still qualify today (no usable real-time event now either)
   * are reverted, back to the platform defaults — FEEDBACK and Live Events on
   * — rather than guessing at CHECKLIST for a subset with no signal to
   * distinguish them.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "scenarios" s
      SET "metadata" = (COALESCE(s."metadata", '{}'::jsonb) - 'experienceMode' - 'liveTabEnabled')
      WHERE s."metadata" ->> 'experienceMode' = 'NONE'
        AND s."metadata" ->> 'liveTabEnabled' = 'false'
        AND NOT EXISTS (
          SELECT 1 FROM "scenario_events" se
          WHERE se."scenarioId" = s.id
            AND se."deletedAt" IS NULL
            AND se."autoTerminationStatus" = false
            AND se."feedbackStatus" = true
            AND se."message" IS NOT NULL AND se."message" != ''
            AND se."emoji" IS NOT NULL AND se."emoji" != ''
        )
    `);
  }
}
