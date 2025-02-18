import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeedbackTable1739870552294 implements MigrationInterface {
  name = 'CreateFeedbackTable1739870552294';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "feedback" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "feedbackId" SERIAL NOT NULL, "modifiedContent" character varying, "rating" double precision, "messageId" integer NOT NULL, "userId" integer NOT NULL, CONSTRAINT "PK_3b500d42f7115ffdbfd1190b2e0" PRIMARY KEY ("feedbackId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "message_id_index" ON "feedback" ("messageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "user_id_index" ON "feedback" ("userId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."user_id_index"`);
    await queryRunner.query(`DROP INDEX "public"."message_id_index"`);
    await queryRunner.query(`DROP TABLE "feedback"`);
  }
}
