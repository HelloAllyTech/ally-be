import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove Roleplay Studio v2. It was an experiment; Sandeep, its author,
 * confirmed it can go. Production held two specs, both titled "Untitled
 * roleplay" and both DRAFT — never published, never run by a learner.
 *
 * Drops the nine tables the feature owned:
 *  - roleplay_specs            (1811)  authoring root
 *  - roleplay_spec_versions    (1811)  immutable snapshots
 *  - roleplay_spec_tenants     (1811)  per-tenant visibility
 *  - copilot_sessions          (1812)  spec-authoring copilot
 *  - copilot_messages          (1812)
 *  - roleplay_director_events  (1811)  live-run telemetry
 *  - roleplay_rubric_scores    (1811)
 *  - roleplay_test_runs        (1866)  Improve harness
 *  - roleplay_test_reports     (1866)
 *
 * Order matters: children before parents, since 1811/1812/1866 declared real
 * FKs between them. CASCADE is deliberately NOT used — an unexpected dependent
 * should fail this migration loudly rather than be silently dropped with it.
 * That paid off immediately: a local run failed on two analytics-agent views
 * built over these tables by migration 1932, which a CASCADE would have taken
 * out silently. They are dropped explicitly below. A pg_depend query over all
 * nine tables confirmed those two are the only dependents.
 *
 * Also deletes the orphaned `scenarios` shells. Creating a spec inserted a thin
 * DRAFT scenarios row with engine='ROLEPLAY_V2' up front (see
 * RoleplaySpecService.create), so those rows exist even for a never-published
 * spec. The repository used to filter them out of every listing; that filter is
 * removed in this change, so leaving the rows would surface two "Untitled
 * roleplay" drafts in the admin Roleplays list. Scoped by engine, so no
 * SIMULATION row can be touched.
 *
 * `down` is NOT reversible for data. It recreates nothing: the schemas live in
 * migrations 1811/1812/1866 and reproducing them here would duplicate ~300
 * lines that could drift from the originals. Rolling back past this point means
 * restoring from a snapshot. Stated plainly rather than implied by an empty
 * method.
 */
export class DropRoleplayStudioV21941000000000 implements MigrationInterface {
  name = 'DropRoleplayStudioV21941000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The analytics-agent exclusion views built over two of these tables by
    // 1932. Must go first: Postgres refuses to drop a table a view selects
    // from. 1932 runs earlier in sequence, so a from-scratch rebuild still
    // creates then drops them in order.
    await queryRunner.query(
      `DROP VIEW IF EXISTS "analytics_agent_roleplay_rubric_scores"`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS "analytics_agent_roleplay_director_events"`,
    );

    // Orphan scenario shells first, while `engine` still identifies them.
    await queryRunner.query(
      `DELETE FROM "scenarios" WHERE "engine" = 'ROLEPLAY_V2'`,
    );

    // Children before parents.
    await queryRunner.query(`DROP TABLE IF EXISTS "copilot_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "copilot_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_test_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_test_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_rubric_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_director_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_spec_tenants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_spec_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_specs"`);

    // The five Studio v2 permissions, and the group grants referencing them.
    // Table is `group_permissions` with a "permissionId" column — mirrors the
    // cleanup in 1817-RoleplayStudioPermissions rather than guessing a schema.
    const names = [
      'view:roleplay-specs',
      'edit:roleplay-spec',
      'delete:roleplay-spec',
      'edit:roleplay-copilot',
      'edit:roleplay-spec-tenant',
    ];
    for (const name of names) {
      await queryRunner.query(
        `DELETE FROM group_permissions
           WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
        name,
      ]);
    }
  }

  public async down(): Promise<void> {
    throw new Error(
      'DropRoleplayStudioV2 is not reversible. The nine table schemas live in ' +
        'migrations 1811/1812/1866; restore from a snapshot to go back.',
    );
  }
}
