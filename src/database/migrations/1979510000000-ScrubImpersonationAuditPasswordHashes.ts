import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the impersonated user's password hash from past
 * SUPER_ADMIN_IMPERSONATE audit rows.
 *
 * Until ally-be#673, AuthService.impersonate selected the `password` column
 * and logged the whole user object as `details.userDetails`, so every
 * impersonation recorded that user's hash. The code no longer does; this
 * clears the rows already in `audit_logs`. Everything else on the row — who
 * was impersonated, when, from where — is the audit trail and stays.
 *
 * Copies already shipped to the CloudWatch audit log group cannot be edited
 * from here; they age out with that group's retention.
 *
 * Irreversible by design: `down` cannot restore a hash and must not try.
 */
export class ScrubImpersonationAuditPasswordHashes1979510000000 implements MigrationInterface {
  name = 'ScrubImpersonationAuditPasswordHashes1979510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "audit_logs"
      SET "details" = "details" #- '{userDetails,password}'
      WHERE "eventType" = 'SUPER_ADMIN_IMPERSONATE'
        AND jsonb_typeof("details" -> 'userDetails') = 'object'
        AND ("details" -> 'userDetails') ? 'password'
    `);
  }

  public async down(): Promise<void> {
    // Nothing to restore — see the class comment.
  }
}
