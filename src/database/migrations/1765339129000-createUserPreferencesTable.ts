import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserPreferencesTable1765339129000
  implements MigrationInterface
{
  name = 'CreateUserPreferencesTable1765339129000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_preferences" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{"default_language_id": 1}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_preferences_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_user_preferences_user_id" ON "user_preferences" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_user_preferences_user_id"`);
    await queryRunner.query(`DROP TABLE "user_preferences"`);
  }
}
