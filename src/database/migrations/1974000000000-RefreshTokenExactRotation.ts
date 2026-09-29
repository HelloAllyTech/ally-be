import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes refresh-token rotation real.
 *
 * `refresh_token.token` held a bcrypt hash, and bcrypt reads only the first 72
 * bytes of its input. Every JWT for one user shares those 72 bytes (the header,
 * then `{"sub":<id>,"username":"...`), so any of a user's refresh tokens matched
 * any of their rows: a rotated token stayed valid for its whole JWT lifetime,
 * and rows were never cleaned up (hundreds per user in prod).
 *
 * New rows store a SHA-256 of the whole token in the same column, and a used
 * token is stamped `rotatedAt` instead of deleted, so a concurrent refresh
 * from a second tab or device can still exchange it inside a short grace
 * window (see `REFRESH_TOKEN_REUSE_GRACE_MS`). Legacy bcrypt rows are left as
 * they are and simply expire.
 *
 * The `userId` index backs the per-refresh lookup and the pruning of a user's
 * dead rows; the table had no index besides its primary key.
 */
export class RefreshTokenExactRotation1974000000000 implements MigrationInterface {
  name = 'RefreshTokenExactRotation1974000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMP NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_token_userId" ON "refresh_token" ("userId")`,
    );
    // Expired rows can never authenticate; dropping them now just stops the
    // first refresh after deploy from pruning a user's whole backlog.
    await queryRunner.query(
      `DELETE FROM "refresh_token" WHERE "expiresAt" < now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_token_userId"`);
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN IF EXISTS "rotatedAt"`,
    );
  }
}
