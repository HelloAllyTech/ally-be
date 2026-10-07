import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Skill experiments — the auto-improve loop for System Skills (`prompts`).
 *
 *  - `skill_experiments` — one row per skill: on/off state, the admin's rubric
 *    and thresholds, and pointers to the current champion/challenger.
 *    Cascades from `prompts`.
 *  - `skill_experiment_variants` — the original snapshot and every drafted
 *    challenger (served, retired or rejected), with a stats snapshot.
 *  - `skill_experiment_observations` — one execution of the skill under the
 *    experiment: raw input, output, and the judge's verdict. Holds skill input
 *    and output verbatim and is kept indefinitely (product decision).
 *  - `skill_experiment_events` — the append-only timeline.
 *
 * Permissions `view:/edit:admin:skill-experiments` are granted by CAPABILITY:
 * every group that already holds `edit:admin:prompts` gets both. Roles are
 * cloned per tenant under any name, so a name list would miss clones (see
 * GrantViewTagsToTagRaters1954000000000). Not `view:admin:prompts`: that
 * includes multi-tenant admins, and observations span every tenant.
 *
 * NOTE: group permissions are cached in Redis (`group:permissions:*`,
 * `user:roles:*`) for 30 minutes and a migration cannot bust them — the new
 * tab appears for existing sessions up to 30 minutes after this runs.
 *
 * Hand-written SQL, never `migration:generate`.
 */
const VIEW_SKILL_EXPERIMENT = 'view:admin:skill-experiments';
const EDIT_SKILL_EXPERIMENT = 'edit:admin:skill-experiments';
const EDIT_PROMPT = 'edit:admin:prompts';

export class CreateSkillExperiments1975830000000 implements MigrationInterface {
  name = 'CreateSkillExperiments1975830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skill_experiments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promptId" uuid NOT NULL,
        "promptCode" character varying(255) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'off',
        "pausedReason" character varying(32),
        "run" integer NOT NULL DEFAULT 0,
        "rubric" jsonb NOT NULL DEFAULT '[]',
        "targetScore" numeric(5,2) NOT NULL DEFAULT 85,
        "minSamplesPerVariant" integer NOT NULL DEFAULT 30,
        "challengerTrafficPercent" integer NOT NULL DEFAULT 30,
        "maxVariants" integer NOT NULL DEFAULT 8,
        "maxConsecutiveLosses" integer NOT NULL DEFAULT 3,
        "minImprovement" numeric(5,2) NOT NULL DEFAULT 2,
        "judgeModel" character varying(100),
        "designerModel" character varying(100),
        "baseContentHash" character varying(64),
        "outputShape" jsonb,
        "championVariantId" uuid,
        "challengerVariantId" uuid,
        "variantsDrafted" integer NOT NULL DEFAULT 0,
        "consecutiveLosses" integer NOT NULL DEFAULT 0,
        "designFailures" integer NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP,
        "pausedAt" TIMESTAMP,
        "lastTickAt" TIMESTAMP,
        "lastError" text,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skill_experiments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_skill_experiments_status" CHECK ("status" IN ('off', 'baseline', 'testing', 'paused')),
        CONSTRAINT "CHK_skill_experiments_paused_reason" CHECK ("pausedReason" IS NULL OR "pausedReason" IN ('target_reached', 'baseline_meets_target', 'max_variants', 'no_progress', 'designer_failed')),
        CONSTRAINT "CHK_skill_experiments_rubric_array" CHECK (jsonb_typeof("rubric") = 'array'),
        CONSTRAINT "CHK_skill_experiments_target" CHECK ("targetScore" >= 0 AND "targetScore" <= 100),
        CONSTRAINT "CHK_skill_experiments_traffic" CHECK ("challengerTrafficPercent" BETWEEN 1 AND 50),
        CONSTRAINT "FK_skill_experiments_prompt" FOREIGN KEY ("promptId")
          REFERENCES "prompts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_skill_experiments_prompt" ON "skill_experiments" ("promptId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skill_experiment_variants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "experimentId" uuid NOT NULL,
        "run" integer NOT NULL,
        "ordinal" integer NOT NULL,
        "label" character varying(32) NOT NULL,
        "isOriginal" boolean NOT NULL DEFAULT false,
        "content" text NOT NULL,
        "contentHash" character varying(64) NOT NULL,
        "parentVariantId" uuid,
        "status" character varying(16) NOT NULL,
        "changeSummary" text,
        "hypothesis" text,
        "designerModel" character varying(100),
        "statusReason" text,
        "launchedAt" TIMESTAMP,
        "retiredAt" TIMESTAMP,
        "judgedCount" integer NOT NULL DEFAULT 0,
        "meanScore" numeric(5,2),
        "scoreStdDev" numeric(6,3),
        "criterionMeans" jsonb,
        "formatFailures" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skill_experiment_variants" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_skill_experiment_variants_status" CHECK ("status" IN ('champion', 'challenger', 'retired', 'rejected')),
        CONSTRAINT "FK_skill_experiment_variants_experiment" FOREIGN KEY ("experimentId")
          REFERENCES "skill_experiments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_skill_experiment_variants_run_ordinal" ON "skill_experiment_variants" ("experimentId", "run", "ordinal")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skill_experiment_observations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "experimentId" uuid NOT NULL,
        "variantId" uuid NOT NULL,
        "promptCode" character varying(255) NOT NULL,
        "tenantId" character varying,
        "input" jsonb NOT NULL,
        "output" text,
        "skillError" text,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "formatOk" boolean,
        "score" numeric(5,2),
        "criterionScores" jsonb,
        "judgeSummary" text,
        "judgeModel" character varying(100),
        "judgeError" text,
        "judgeAttempts" integer NOT NULL DEFAULT 0,
        "judgedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skill_experiment_observations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_skill_experiment_observations_status" CHECK ("status" IN ('pending', 'judged', 'failed')),
        CONSTRAINT "FK_skill_experiment_observations_experiment" FOREIGN KEY ("experimentId")
          REFERENCES "skill_experiments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_skill_experiment_observations_variant" FOREIGN KEY ("variantId")
          REFERENCES "skill_experiment_variants"("id") ON DELETE CASCADE
      )
    `);
    // The judge's work queue, and the per-variant stats aggregate.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_skill_experiment_observations_experiment_status" ON "skill_experiment_observations" ("experimentId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_skill_experiment_observations_variant_status" ON "skill_experiment_observations" ("variantId", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skill_experiment_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "experimentId" uuid NOT NULL,
        "variantId" uuid,
        "type" character varying(32) NOT NULL,
        "message" text NOT NULL,
        "metadata" jsonb,
        "actorId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skill_experiment_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_skill_experiment_events_type" CHECK ("type" IN ('configured', 'started', 'stopped', 'baseline_ready', 'variant_launched', 'variant_rejected', 'variant_retired', 'champion_changed', 'paused', 'resumed', 'reset', 'applied', 'error')),
        CONSTRAINT "FK_skill_experiment_events_experiment" FOREIGN KEY ("experimentId")
          REFERENCES "skill_experiments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_skill_experiment_events_experiment_created" ON "skill_experiment_events" ("experimentId", "createdAt")`,
    );

    for (const permission of [VIEW_SKILL_EXPERIMENT, EDIT_SKILL_EXPERIMENT]) {
      await queryRunner.query(
        // $1 is cast explicitly: in a bare `SELECT $1` Postgres has no column
        // to infer the parameter type from.
        `INSERT INTO "permissions" ("name")
         SELECT $1::varchar
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
        [permission],
      );
      await queryRunner.query(
        `INSERT INTO "group_permissions" ("groupId", "permissionId")
         SELECT DISTINCT editor."groupId", granted.id
         FROM "group_permissions" editor
         JOIN "permissions" held
           ON held.id = editor."permissionId" AND held.name = $1
         JOIN "permissions" granted
           ON granted.name = $2
         WHERE NOT EXISTS (
           SELECT 1 FROM "group_permissions" existing
           WHERE existing."groupId" = editor."groupId"
             AND existing."permissionId" = granted.id
         )`,
        [EDIT_PROMPT, permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" gp
       USING "permissions" p
       WHERE gp."permissionId" = p.id AND p.name IN ($1, $2)`,
      [VIEW_SKILL_EXPERIMENT, EDIT_SKILL_EXPERIMENT],
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN ($1, $2)`,
      [VIEW_SKILL_EXPERIMENT, EDIT_SKILL_EXPERIMENT],
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_experiment_events"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "skill_experiment_observations"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_experiment_variants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_experiments"`);
  }
}
