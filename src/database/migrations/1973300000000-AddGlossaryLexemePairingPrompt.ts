import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds `glossary_lexeme_pairing`, the prompt behind bookish-word mining
 * (GlossaryLexemeMiningService).
 *
 * The miner finds words the role-play agent over-uses relative to how the
 * counsellors in the same language actually speak (lexeme-mining.util); this
 * prompt decides, per candidate, whether it is a register problem at all and
 * if so what the population says instead. Most candidates are NOT problems —
 * a client naturally says "sleep" or "husband" more than the counsellor does —
 * so "keep" is a first-class answer, not a failure.
 *
 * Output entries use the canonical `- meaning: say \`X\` (avoid: \`Y\`)` form
 * because that is the only form the agent was measured to obey
 * (glossary-rule-form.util: 100% vs 4% compliance).
 */
export class AddGlossaryLexemePairingPrompt1973300000000 implements MigrationInterface {
  name = 'AddGlossaryLexemePairingPrompt1973300000000';

  private readonly code = 'glossary_lexeme_pairing';

  private readonly template = `You maintain the {{languageName}} ({{languageCode}}) glossary for an AI that role-plays CLIENTS in counselling practice sessions. Counsellors practise on it, so it must sound like a real person from their community talking — spoken, everyday {{languageName}}, not written, textbook or translated language.

We compared the words the AI says with the words real counsellors say in these same sessions (counsellors' repetitions of the AI's own words were removed first). Below are the words the AI uses far more than the people it imitates. For each, decide whether it is a REGISTER problem and, if so, what a real speaker would say instead.

THE EXISTING GLOSSARY — already in the AI's prompt; never propose something it already covers:
{{existingGlossary}}

WHAT REAL COUNSELLORS SAY MOST (their own words, most frequent first) — prefer replacements from this vocabulary when one fits:
{{learnerLexicon}}

CANDIDATES — each: the word, how often the AI said it vs counsellors, and the AI's own sentences using it:
{{candidates}}

DECIDE EACH CANDIDATE
- "pair": the word is literary, formal, bookish, archaic or translated-sounding for spoken {{languageName}}, and ordinary speakers use a different word or form. Give the everyday replacement.
- "keep": the word is fine in speech. The AI simply says it more because of its ROLE — a client describes their own life (sleep, work, family, feelings), while the counsellor asks questions. Frequency alone is not a problem. Also keep names, numbers, and anything you are unsure of.

RULES FOR A PAIR
- "say" must be what people actually SAY, in native script, in the same meaning and grammatical role, so it can stand in the AI's sentence.
- Do not replace a word with an English loanword unless speakers of this community genuinely use that loanword (the counsellor vocabulary above is your evidence).
- Never "fix" address forms or pronouns (formal vs informal "you"): that choice depends on the persona, not the language. Answer "keep" for those.
- If the colloquial form is a change of ending (verb or case morphology) rather than a different word, you may still pair it, but set wordClass to "verb_form".

Return ONLY a JSON array, no prose, no markdown fence, one object per candidate you decide:
[{"index": 1, "verdict": "pair", "avoid": "<the candidate, exactly as given>", "say": "<everyday form>", "meaning": "<short English gloss>", "wordClass": "discourse_marker|conjunction|lexeme|verb_form|pronoun_address|other", "reason": "<short clause>"},
 {"index": 2, "verdict": "keep", "reason": "<short clause>"}]`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const name = 'Language Glossary Lexeme Pairing Prompt';
    const description =
      'Pairs words the role-play agent over-uses (vs counsellor speech) with their colloquial equivalents, or keeps them. Output: strict JSON consumed by the lexeme-mining job.';

    // Arbiter-less ON CONFLICT, as in AddGlossaryConsolidationPrompt: the
    // deploy can run migrations twice concurrently, and prompts carries unique
    // indexes on both promptCode and name.
    await queryRunner.query(
      `INSERT INTO "prompts"
         ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "provider", "model")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [this.code, name, description, 1, true, 'gemini', 'gemini-2.5-pro'],
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
