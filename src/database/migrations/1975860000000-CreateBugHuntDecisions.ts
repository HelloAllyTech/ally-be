import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The decision log (OPP-0776, shipped with the Finder stage OPP-0781): one row
 * per orchestration choice, with the menu, the pick, who owned it, the shadow
 * owner's pick and the reason. See `BugHuntDecision` for why the shadow is
 * the point. No foreign keys, matching `bug_hunt_events`: a decision outlives
 * a deleted run and must stay readable for the replay.
 */
export class CreateBugHuntDecisions1975860000000 implements MigrationInterface {
  name = 'CreateBugHuntDecisions1975860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bug_hunt_decisions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid,
        "finding_id" uuid,
        "repo" text,
        "point" character varying(8) NOT NULL,
        "owner" character varying(8) NOT NULL,
        "menu" jsonb NOT NULL,
        "pick" jsonb NOT NULL,
        "shadow_owner" character varying(8),
        "shadow_pick" jsonb,
        "reason" text,
        "inputs" jsonb,
        "model" character varying(64),
        "outcome" character varying(16),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunt_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunt_decisions_owner" CHECK ("owner" IN ('model', 'rule')),
        CONSTRAINT "CHK_bug_hunt_decisions_shadow_owner" CHECK ("shadow_owner" IS NULL OR "shadow_owner" IN ('model', 'rule')),
        CONSTRAINT "CHK_bug_hunt_decisions_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('better', 'same', 'worse'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_decisions_run_id" ON "bug_hunt_decisions" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_decisions_finding_id" ON "bug_hunt_decisions" ("finding_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_decisions_point_created" ON "bug_hunt_decisions" ("point", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bug_hunt_decisions"`);
  }
}
