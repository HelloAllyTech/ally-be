import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDebriefFeedbackTable1979000000000 implements MigrationInterface {
  name = 'CreateDebriefFeedbackTable1979000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "debrief_feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "scenarioSessionId" uuid NOT NULL,
        "rating" character varying(16) NOT NULL,
        "comment" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_debrief_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_debrief_feedback_scenarioSessionId" UNIQUE ("scenarioSessionId"),
        CONSTRAINT "CHK_debrief_feedback_rating" CHECK ("rating" IN ('positive', 'negative'))
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "skill_experiment_observations" ADD COLUMN "context" jsonb`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_skill_experiment_observations_context_session_id" ON "skill_experiment_observations" (("context"->>'scenarioSessionId'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_skill_experiment_observations_context_session_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "skill_experiment_observations" DROP COLUMN IF EXISTS "context"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_feedback"`);
  }
}
