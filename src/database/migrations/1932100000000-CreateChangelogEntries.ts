import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChangelogEntries1932100000000 implements MigrationInterface {
  name = 'CreateChangelogEntries1932100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "changelog_entries" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repo" character varying NOT NULL, "releaseNoteText" text NOT NULL, "mergedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_fb966e0e6c2c82063cbb728cab3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_changelog_entries_merged_at" ON "changelog_entries" ("mergedAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_changelog_entries_merged_at"`,
    );
    await queryRunner.query(`DROP TABLE "changelog_entries"`);
  }
}
