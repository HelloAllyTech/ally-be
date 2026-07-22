import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the `glossary_generation` prompt — the system prompt that generates a
 * language's DRAFT glossary sections (LANGUAGE_GLOSSARY_DESIGN.md §6.1, GL-4).
 *
 * The glossary "constrains and corrects" a language the LLM half-knows: it is
 * not teaching material but do/don't term pairs, agreement rules with examples,
 * and exemplar utterances. Output is strict JSON so the seed job can upsert
 * typed entries; drafts always go through native-speaker review before publish.
 *
 * Seeded with `useDashboardOverride = true` (DB-versioned, editable from Prompt
 * Management) and `provider='gemini' / model='gemini-2.5-pro'` like the
 * agent-template translation prompt.
 */
export class AddGlossaryGenerationPrompt1861000000000 implements MigrationInterface {
  name = 'AddGlossaryGenerationPrompt1861000000000';

  private readonly code = 'glossary_generation';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const name = 'Language Glossary Generation Prompt';
    const description =
      'System prompt that generates draft glossary sections (term pairs, rules, patterns) for a language. Output: strict JSON consumed by the glossary seed job.';

    const template = `You are an expert sociolinguist and localizer for a voice-AI mental-health training platform operating in India. AI agents role-play as clients speaking {{languageName}} (code: {{languageCode}}), but the underlying LLM only partially knows the language. Your job is to produce a compact GLOSSARY that CONSTRAINS and CORRECTS the agent's {{languageName}} — not to teach the language.

Language eval config (script, target variety, diglossia): {{evalConfig}}

The agents' known failure modes, in priority order:
1. Register mixing: literary/formal register leaks into clinical or emotional topics; conversation must stay COLLOQUIAL SPOKEN {{languageName}} throughout.
2. Grammatical agreement errors: wrong gender pronouns/verb forms, especially for female kin (mother, sister, wife).
3. Unnatural phrasing: word-for-word translations instead of how a native speaker actually talks.

Produce sections as STRICT JSON (no markdown fences, no commentary) — an array of objects:
[
  {
    "sectionCode": "core_style",
    "title": "Core style",
    "injectionMode": "always",
    "retrievalHint": null,
    "entries": [ ... ]
  },
  ...
]

Each entry is one of three types:
- {"type": "term_pair", "english": "<English term>", "preferred": "<colloquial spoken form, native script>", "avoid": "<literary/formal form to avoid>", "note": "<optional 1-line usage note>"}
- {"type": "rule", "text": "<one-line rule in English>", "examples": ["<native-script example sentence>", "..."]}
- {"type": "pattern", "text": "<conversational move in English>", "examples": ["<native-script exemplar utterance>", "..."]}

REQUIRED SECTIONS:
1. "core_style" (injectionMode "always"): 6-10 entries — the register policy (rules: which variety/register to speak, code-mixing policy: keep commonly code-mixed English words like app, tension, call, medicine as spoken), plus the highest-impact term pairs.
2. "pronouns_kinship" (injectionMode "always"): 4-8 rule entries — gender/honorific agreement for kin terms (mother, father, sister, spouse), each with 2-3 native-script examples using correct pronouns/verb agreement.
3. "clinical_terms" (injectionMode "retrieved", retrievalHint "Retrieve when the reply is turning toward diagnosis, symptoms, medication, therapy, or health advice"): 10-20 term_pair entries — clinical/therapy vocabulary in colloquial register.
4. "emotions" (injectionMode "retrieved", retrievalHint "Retrieve when the reply will express or discuss feelings, moods, or emotional states"): 8-15 term_pair or pattern entries.
5. "smalltalk" (injectionMode "retrieved", retrievalHint "Retrieve for greetings, openings, closings, and casual chit-chat"): 6-12 pattern entries.

RULES:
- Native script only for {{languageName}} text (no transliteration), matching the script in the eval config.
- Colloquial SPOKEN register everywhere — write examples the way people talk, not the way textbooks write.
- English scaffolding: "english"/"text"/"note" fields in English; "preferred"/"avoid"/"examples" in native script.
- Keep "always" sections tight: they are injected into every conversational turn under a strict token budget.
- Return ONLY the JSON array.`;

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
