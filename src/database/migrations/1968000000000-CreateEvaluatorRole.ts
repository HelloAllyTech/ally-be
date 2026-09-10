import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the EVALUATOR consumer-app role and its single permission.
 *
 * An evaluator is an ordinary app user — learner, counsellor — who has also
 * agreed to answer evaluation questions the product puts in front of them on
 * particular screens and at particular moments. The role is therefore purely
 * additive: it is granted alongside the account's real app role and carries
 * nothing but `evaluator:access`, which the surfaces that ask those questions
 * gate on. Granting it can neither widen nor narrow what the account could
 * already do.
 *
 * The questions themselves and where they appear are not part of this
 * migration; this is the audience, not the content.
 *
 * Nothing is backfilled — the role starts with no holders, and is assigned per
 * user from the admin console's role picker, which lists every group
 * `GET /v1/authorization/roles` returns that is not platform-managed.
 *
 * NOTE: permissions are cached in Redis (`group:permissions:*`,
 * `user:groups:*`, `user:roles:*`, 30-minute TTL) and a raw SQL migration
 * cannot bust them. That only matters for a group that already has holders, so
 * it is moot here — but it will matter the first time a permission is added to
 * this role.
 */
const EVALUATOR_GROUP = 'EVALUATOR';
const EVALUATOR_ACCESS = 'evaluator:access';

export class CreateEvaluatorRole1968000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `$1::varchar` rather than a bare `$1`: in `SELECT $1` Postgres has no
    // column to infer the parameter type from and rejects text vs varchar.
    await queryRunner.query(
      `INSERT INTO "groups" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE name = $1::varchar)`,
      [EVALUATOR_GROUP],
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
      [EVALUATOR_ACCESS],
    );

    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g.id, p.id
       FROM "groups" g
       JOIN "permissions" p ON p.name = $2
       WHERE g.name = $1
         AND NOT EXISTS (
           SELECT 1 FROM "group_permissions" existing
           WHERE existing."groupId" = g.id
             AND existing."permissionId" = p.id
         )`,
      [EVALUATOR_GROUP, EVALUATOR_ACCESS],
    );
  }

  /**
   * Drops the role outright, including any `user_groups` rows assigning it.
   *
   * Safe in a way most role removals are not: `evaluator:access` grants no
   * access to anything an account did not already have, so a user who loses it
   * loses only the evaluation questions. Every evaluator holds a second,
   * untouched app role, so nobody is left role-less.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_groups"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [EVALUATOR_GROUP],
    );

    await queryRunner.query(
      `DELETE FROM "group_permissions"
       WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = $1)`,
      [EVALUATOR_ACCESS],
    );

    await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
      EVALUATOR_ACCESS,
    ]);

    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [
      EVALUATOR_GROUP,
    ]);
  }
}
