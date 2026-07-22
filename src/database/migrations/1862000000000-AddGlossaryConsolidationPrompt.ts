import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the `glossary_consolidation` prompt — the system prompt that turns the
 * language judge's error annotations into PROPOSED glossary entries
 * (LANGUAGE_GLOSSARY_DESIGN.md §6.2, Phase 4).
 *
 * Consolidation is compression: many observed error instances become few
 * generalized rules/term pairs. Output entries land as entry-status
 * 'proposed' with provenance back to the annotations they generalize; the
 * compiler ignores them until a human accepts, so this can never change what
 * agents say on its own.
 *
 * Seeded with `useDashboardOverride = true` and `provider='gemini'` like the
 * glossary_generation prompt.
 */
export class AddGlossaryConsolidationPrompt1862000000000 implements MigrationInterface {
  name = 'AddGlossaryConsolidationPrompt1862000000000';

  private readonly code = 'glossary_consolidation';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const name = 'Language Glossary Consolidation Prompt';
    const description =
      'System prompt that clusters language-judge error annotations into proposed glossary entries (term pairs, rules, patterns). Output: strict JSON consumed by the consolidation job.';

    const template = `You are an expert sociolinguist maintaining a per-language GLOSSARY that constrains and corrects an AI agent speaking {{languageName}} (code: {{languageCode}}). A language-quality judge has flagged errors in real agent conversations. Your job is CONSOLIDATION: cluster these raw error instances into a FEW generalized glossary entries that would prevent them.

Consolidation is compression — many instances become few rules:
- If several annotations show the same class of mistake (e.g. literary register for clinical words, wrong gender agreement for a kin term), produce ONE entry that generalizes it.
- Prefer amending the vocabulary domain where the error lives (clinical terms, emotions, pronouns) over inventing new sections.
- Do NOT restate errors that the existing glossary already covers (existing entries are listed below).
- Fewer, higher-leverage entries beat many narrow ones. Skip one-off errors that don't generalize.

THE EXISTING GLOSSARY (do not duplicate; use these sectionCodes when the entry belongs there):
{{existingGlossary}}

THE ERROR ANNOTATIONS (numbered; each has dimension, category, severity, the offending span, and the judge's reasoning):
{{annotations}}

Return STRICT JSON (no markdown fences, no commentary) — an array of sections to amend or create:
[
  {
    "sectionCode": "<existing code, or a new snake_case code>",
    "title": "<required for NEW sections only>",
    "injectionMode": "<'always'|'retrieved', NEW sections only; default 'retrieved'>",
    "retrievalHint": "<NEW retrieved sections only: one line saying when to pull it>",
    "entries": [
      {
        "type": "term_pair" | "rule" | "pattern",
        "english": "...", "preferred": "<native script>", "avoid": "<native script>",
        "text": "<one-line rule in English (rule/pattern)>",
        "examples": ["<native-script example>", "..."],
        "note": "<optional 1-line usage note>",
        "importance": <1-5, 5 = most frequent/severe in the annotations>,
        "sourceAnnotationIndexes": [<numbers of the annotations this entry generalizes>]
      }
    ]
  }
]

RULES:
- Native script for all {{languageName}} text; colloquial SPOKEN register.
- English scaffolding: "english"/"text"/"note" in English.
- Every entry MUST list the sourceAnnotationIndexes it generalizes.
- Only propose 'always' placement for standing constraints (register policy, agreement rules) that matter on every turn.
- Return ONLY the JSON array. Return [] if nothing generalizes.`;

    await queryRunner.query(
      `INSERT INTO "prompts"
         ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "provider", "model")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [this.code, name, description, 1, true, 'gemini', 'gemini-2.5-pro'],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [template, this.code],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [this.code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
         USING "prompts" p
         WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [this.code],
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      this.code,
    ]);
  }
}
