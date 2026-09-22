import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  BuilderEventType,
  BuilderExemplarOutcome,
  BuilderLessonCategory,
  BuilderLessonStatus,
  BuilderMessageRole,
  BuilderMilestoneStatus,
  BuilderNotificationKind,
  BuilderPrdVersionAuthor,
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
  BuilderQuestionStatus,
  BuilderReportType,
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
  BuilderSteerStatus,
} from '../../builder/enum/builder.enum';

/**
 * Every value a TypeScript enum can produce must be a value its column's CHECK
 * constraint accepts.
 *
 * This gap bit the same feature twice in two days. `BuilderStage.REVIEWING` was
 * added and `CHK_builder_sessions_stage` was extended — that one was caught
 * before shipping. `BuilderRunMode.REVIEW` was added and
 * `CHK_builder_build_runs_mode` was not, so every review run failed at the
 * INSERT in production with "violates check constraint", and because the
 * dispatch stamps its bookkeeping first, two pull requests were marked reviewed
 * for reviews that never ran.
 *
 * Nothing else could catch it. The enum compiles, the entity compiles, the
 * service unit tests mock the repository, and the module-compile guard resolves
 * the DI graph without touching a database. The constraint only speaks when a
 * real row reaches real Postgres.
 *
 * So this reads the migrations as text and compares the last definition of each
 * constraint against the enum it guards. Text rather than a live database
 * because it has to run in the same suite as everything else, with no
 * container — and the failure mode it prevents is a value missing from a
 * literal list, which is exactly what text can see.
 */
describe('CHECK constraints cover their enums', () => {
  const dir = __dirname;
  /**
   * Only the `up()` half of each migration. A `down()` deliberately restores
   * the NARROWER list it is reverting to, and those definitions sit later in
   * the file — so scanning whole files finds a rollback's constraint and
   * reports every newer enum value as missing. That is what this test did on
   * its first run, and it is a fair warning about reading migrations as text.
   */
  const sql = readdirSync(dir)
    .filter((file) => /^\d+-.*\.ts$/.test(file))
    .sort()
    .map(
      (file) =>
        readFileSync(join(dir, file), 'utf8').split(/public async down/)[0],
    )
    .join('\n');

  /**
   * The last `CONSTRAINT <name> CHECK (... IN ('a','b'))` in migration order —
   * later migrations redefine a constraint, and only the final one is what
   * production actually holds.
   *
   * Both spellings, because half of these constraints have only ever been
   * written one way: `builder_sessions.status`, `builder_messages.role` and
   * `builder_build_runs.status` are declared inline inside their CREATE TABLE
   * and never re-added. Matching `ADD CONSTRAINT` alone found nothing for
   * them, which is why the list above could not have been completed without
   * this — and a constraint this test cannot find throws rather than passing
   * quietly.
   *
   * `(?<!DROP )` keeps a `DROP CONSTRAINT IF EXISTS` line from being read as a
   * definition and lazily borrowing the value list of whatever follows it.
   */
  const allowedValues = (constraint: string): string[] => {
    const pattern = new RegExp(
      `(?<!DROP )CONSTRAINT "${constraint}"[\\s\\S]{0,600}?IN \\(([^)]*)\\)`,
      'g',
    );
    const matches = [...sql.matchAll(pattern)];
    if (!matches.length) {
      throw new Error(
        `No migration defines ${constraint}. If the constraint was renamed, ` +
          `update this test — it is the only thing checking the enum against it.`,
      );
    }
    return [...matches[matches.length - 1][1].matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
  };

  /**
   * Every enum-backed column in this module, not just the ones that had already
   * bitten. The first version of this test listed two, and the third failure of
   * the week — `builder_pr_feedback.kind` — was in the pair it did not list. A
   * guard that covers the bugs you have already had is not a guard.
   *
   * It said that and then listed four of the eighteen, which let the same class
   * through three more times: `budget_hold` and `model_escalated` were never
   * added to the events' type CHECK, and `REVIEWING` never reached the events'
   * stage CHECK although the sessions' one was extended in the same migration.
   * The raise-budget dialog 500'd on every submission for as long as the first
   * of those was missing. So the list is now EVERY `CHK_builder_*` constraint
   * that guards an enum — if a new one is added, add it here in the same
   * commit; there is no other check.
   */
  it.each([
    ['CHK_builder_sessions_status', Object.values(BuilderSessionStatus)],
    ['CHK_builder_sessions_stage', Object.values(BuilderStage)],
    ['CHK_builder_messages_role', Object.values(BuilderMessageRole)],
    ['CHK_builder_build_runs_status', Object.values(BuilderRunStatus)],
    ['CHK_builder_build_runs_mode', Object.values(BuilderRunMode)],
    ['CHK_builder_build_events_type', Object.values(BuilderEventType)],
    ['CHK_builder_build_events_stage', Object.values(BuilderStage)],
    ['CHK_builder_questions_status', Object.values(BuilderQuestionStatus)],
    ['CHK_builder_steers_status', Object.values(BuilderSteerStatus)],
    ['CHK_builder_reports_type', Object.values(BuilderReportType)],
    ['CHK_builder_notifications_kind', Object.values(BuilderNotificationKind)],
    ['CHK_builder_milestones_status', Object.values(BuilderMilestoneStatus)],
    ['CHK_builder_prd_versions_author', Object.values(BuilderPrdVersionAuthor)],
    ['CHK_builder_lessons_status', Object.values(BuilderLessonStatus)],
    ['CHK_builder_lessons_category', Object.values(BuilderLessonCategory)],
    ['CHK_builder_exemplars_outcome', Object.values(BuilderExemplarOutcome)],
    ['CHK_builder_pr_feedback_kind', Object.values(BuilderPrFeedbackKind)],
    ['CHK_builder_pr_feedback_status', Object.values(BuilderPrFeedbackStatus)],
  ])('%s accepts every enum value', (constraint, values) => {
    const allowed = allowedValues(constraint as string);
    const missing = (values as string[]).filter((v) => !allowed.includes(v));

    expect({ constraint, missing }).toEqual({ constraint, missing: [] });
  });
});
