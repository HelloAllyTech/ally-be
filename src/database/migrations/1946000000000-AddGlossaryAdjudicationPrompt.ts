import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The adjudicator prompt: decides queued glossary proposals, because there is
 * no reviewer who reads Tamil, Kannada, Hindi and Marathi.
 *
 * Its criteria are not invented — each one is a category that had to be
 * rejected by hand from the first real queue (2026-09-02, 51 proposals, 20
 * rejected):
 *
 *   - 12 proposals were ACTOR BEHAVIOUR, not language ("do not break
 *     character", "avoid numbered lists", "let the counsellor lead"). Real
 *     signal, wrong container: a language glossary is injected per language
 *     and cannot carry persona direction. Largest single category.
 *   - Several restated rules the glossary already had.
 *   - Kannada showed that a rule forbidding a word real speakers use is a bad
 *     rule, not a disobedient agent — the existing CONTRADICTED check exists
 *     for exactly that, and the adjudicator is told to apply the same test.
 *
 * Form is NOT the model's job: `classifyRuleForm` rejects a proposal whose
 * substitution is buried in an example line before any model call, because
 * that shape measured 4% agent compliance against 100% for the canonical
 * one-liner. Asking a model to re-judge measured evidence would be worse.
 *
 * Seeded with `useDashboardOverride = true` and gemini-2.5-pro, matching the
 * consolidation prompt, so a curator can tune the criteria without a deploy.
 */
export class AddGlossaryAdjudicationPrompt1946000000000 implements MigrationInterface {
  name = 'AddGlossaryAdjudicationPrompt1946000000000';

  private readonly code = 'glossary_adjudication';

  private readonly template = `You adjudicate proposed additions to the {{languageName}} ({{languageCode}}) language glossary.

The glossary is injected into a role-play agent's system prompt on EVERY TURN. Its token budget is small and fixed. So a proposal must earn its place: it is worth accepting only if it changes what the agent says in {{languageName}}.

THE EXISTING GLOSSARY (already in the prompt — do not re-accept what this covers):
{{existingGlossary}}

PROPOSALS TO ADJUDICATE:
{{proposals}}

Reject a proposal when any of these hold:

1. IT IS NOT A LANGUAGE RULE. Persona, role-play and conversational-behaviour instructions ("do not break character", "let the counsellor lead", "avoid numbered lists", "do not direct the conversation") belong in the agent's persona prompt, not a per-language glossary. This is the most common reason to reject.
2. IT RESTATES the existing glossary, or another proposal in this batch, even in different words.
3. IT FORBIDS A WORD REAL SPEAKERS USE. If the "avoid" term is ordinary current usage for this variety rather than a formal/literary form, the rule fights the population and will be ignored.
4. IT IS IN THE WRONG LANGUAGE. The rule's content must be about {{languageName}}. A rule about another language's grammar or lexicon has arrived by mistake.
5. IT IS UNVERIFIABLE OR VAGUE — no concrete form to prefer and no concrete form to avoid.

Otherwise accept. A good proposal names the colloquial form to use and the formal or unnatural form to avoid, for a real usage the agent gets wrong.

Judge each proposal on its own merits; support counts indicate how much evidence there was, not whether the rule is right.

Return ONLY a JSON array, one object per proposal, no prose and no markdown fence:

[{"index": 1, "verdict": "accept", "reason": "<one short clause>"},
 {"index": 2, "verdict": "reject", "reason": "<one short clause naming which rule above applies>"}]

Every proposal you were given must appear exactly once. If you are genuinely unsure, omit it rather than guessing — an omitted proposal is held for a human, and that is a safe outcome.`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts"
         ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "provider", "model")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        this.code,
        'Glossary adjudication',
        'Decides queued glossary proposals: accepts language rules, rejects ' +
          'persona/behaviour rules, restatements, and rules that fight real usage. ' +
          'Rule FORM is checked deterministically before this prompt runs.',
        1,
        true,
        'gemini',
        'gemini-2.5-pro',
      ],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [this.template, this.code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions"
        WHERE "promptId" IN (SELECT id FROM "prompts" WHERE "promptCode" = $1)`,
      [this.code],
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      this.code,
    ]);
  }
}
