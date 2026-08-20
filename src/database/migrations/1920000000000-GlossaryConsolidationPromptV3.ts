import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidation prompt v3 — two lessons from the first production review
 * (DEMCARES Tamil):
 *
 * 1. Rule-form for grammar: a cluster like அதுக்கு vs அதற்கு is a productive
 *    morphological pattern, and the LLM generalizes better from "state the
 *    rule once + at most two example pairs" than from instance lists (which
 *    also scale badly against the Tier 0 token cap).
 *
 * 2. Engineering findings are not glossary content: 22 annotations of
 *    truncated replies became a "complete your thought" style rule — a
 *    production-artifact symptom a prompt line cannot fix. v3's output
 *    contract adds an engineeringFindings array as the sink for such
 *    clusters; the service reports them on the consolidation batch instead
 *    of proposing them as entries.
 */
export class GlossaryConsolidationPromptV31920000000000 implements MigrationInterface {
  name = 'GlossaryConsolidationPromptV31920000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 3, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = 'glossary_consolidation'
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [CONSOLIDATION_V3],
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 3 WHERE "promptCode" = 'glossary_consolidation' AND "currentVersion" < 3`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2 WHERE "promptCode" = 'glossary_consolidation' AND "currentVersion" = 3`,
    );
  }
}

const CONSOLIDATION_V3 = `You are an expert sociolinguist maintaining a per-language GLOSSARY that constrains and corrects an AI agent speaking {{languageName}} (code: {{languageCode}}). A language-quality judge has flagged errors in real agent conversations. Your job is CONSOLIDATION: cluster these raw error instances into a FEW generalized markdown glossary lines that would prevent them.

Consolidation is compression — many instances become few lines:
- If several annotations show the same class of mistake, produce ONE line that generalizes it.
- When a cluster reflects a PRODUCTIVE grammatical or morphological pattern (verb endings, case-marked stems, clitics, agreement), STATE THE RULE once in plain terms and attach AT MOST two example pairs — never enumerate every instance the pattern covers.
- Prefer amending the vocabulary domain where the error lives (clinical terms, emotions, pronouns) over inventing new sections.
- Do NOT restate what the existing glossary already covers (its content is listed below).
- Fewer, higher-leverage lines beat many narrow ones. Skip one-off errors that don't generalize.
- Some clusters are NOT language knowledge at all: truncated or cut-off replies, verbatim repetition, stuck helpless loops, or other production artifacts. These are ENGINEERING SIGNALS — report them under engineeringFindings, NEVER as glossary proposals. A prompt line cannot fix a pipeline cutoff.

THE EXISTING GLOSSARY (do not duplicate; use these sectionCodes when the line belongs there):
{{existingGlossary}}

THE ERROR ANNOTATIONS (numbered; each has dimension, category, severity, the offending span, and the judge's reasoning):
{{annotations}}

Return STRICT JSON (no markdown fences around the JSON itself) — an object with two arrays:
{
  "sections": [
    {
      "sectionCode": "<existing code, or a new snake_case code>",
      "title": "<required for NEW sections only>",
      "injectionMode": "<'always'|'retrieved', NEW sections only; default 'retrieved'>",
      "retrievalHint": "<NEW retrieved sections only: one line saying when to pull it>",
      "proposals": [
        {
          "markdown": "- <one glossary line in the same markdown style as the existing content; native script for {{languageName}} text; may include an indented 'e.g.' example line>",
          "importance": <1-5, 5 = most frequent/severe in the annotations>,
          "sourceAnnotationIndexes": [<numbers of the annotations this line generalizes>]
        }
      ]
    }
  ],
  "engineeringFindings": [
    {
      "summary": "<one line describing the systemic production artifact and its scale>",
      "sourceAnnotationIndexes": [<numbers of the annotations showing it>]
    }
  ]
}

RULES:
- Native script for all {{languageName}} text; colloquial SPOKEN register.
- Every proposal and finding MUST list the sourceAnnotationIndexes it generalizes.
- Only propose additions to 'always' sections for standing constraints (register policy, agreement rules) that matter on every turn.
- Return ONLY the JSON object. Use empty arrays when nothing applies.`;
