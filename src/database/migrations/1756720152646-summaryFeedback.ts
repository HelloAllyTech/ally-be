import { MigrationInterface, QueryRunner } from 'typeorm';

export class SummaryFeedback1756720152646 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "summary_feedback" ("id" SERIAL NOT NULL, "chatId" integer NOT NULL, "rating" integer NOT NULL, "feedback" jsonb, CONSTRAINT "PK_2f94fd48a24e809eadb1adb8724" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_summary_feedback_chatId_idx" ON "summary_feedback" ("chatId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_summary_feedback_chatId_idx"`,
    );
    await queryRunner.query(`DROP TABLE "summary_feedback"`);
  }
}
