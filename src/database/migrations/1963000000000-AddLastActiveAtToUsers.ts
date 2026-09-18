import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `users.lastActiveAt`, written by `LastActiveService` on a throttled cadence
 * from `JwtStrategy.validate()`. Nullable: existing rows and any user who has
 * never made an authenticated request since this shipped have no value, so
 * the engagement-reminder evaluator falls back to `createdAt` for those via
 * `COALESCE` rather than treating NULL as "always eligible".
 */
export class AddLastActiveAtToUsers1963000000000 implements MigrationInterface {
  name = 'AddLastActiveAtToUsers1963000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "lastActiveAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastActiveAt"`);
  }
}
