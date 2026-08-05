import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Glossary adherence reports (LANGUAGE_GLOSSARY_DESIGN.md §9/§10 analytics).
 *
 * One row per analyzed roleplay session: a deterministic, judge-independent
 * count of glossary avoid-list violations in the agent's utterances. The
 * glossary's term pairs give a machine-checkable lexicon (`say "X"
 * (avoid: "Y")`), so adherence is a plain transcript scan — no LLM, no hand
 * labels — complementing the LLM judge's style dimensions.
 *
 * - `glossaryVersions` records the section versions the scan attributed the
 *   session to (from start_metrics provenance when available, else the
 *   published set at scan time) so adherence trends group by glossary
 *   version, exactly like judge deltas.
 * - `violations` jsonb: [{term, sectionCode, count, examples: [snippet]}].
 * - Re-running a scan upserts by session (unique index) — reports are
 *   derived data, safe to rebuild.
 */
export class CreateGlossaryAdherenceReports1884000000000 implements MigrationInterface {
  name = 'CreateGlossaryAdherenceReports1884000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "glossary_adherence_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scenarioSessionId" uuid NOT NULL,
        "languageId" integer NOT NULL,
        "glossaryVersions" jsonb NOT NULL DEFAULT '{}',
        "agentMessageCount" integer NOT NULL DEFAULT 0,
        "totalViolations" integer NOT NULL DEFAULT 0,
        "violations" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_glossary_adherence_reports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_glossary_adherence_reports_sessionId"
          FOREIGN KEY ("scenarioSessionId") REFERENCES "scenario_sessions"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_glossary_adherence_reports_languageId"
          FOREIGN KEY ("languageId") REFERENCES "languages"("id")
          ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_glossary_adherence_reports_session"
        ON "glossary_adherence_reports" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_glossary_adherence_reports_language"
        ON "glossary_adherence_reports" ("languageId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "glossary_adherence_reports"`,
    );
  }
}
