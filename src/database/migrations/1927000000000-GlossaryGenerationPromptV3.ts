import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generation prompt v3 — the seed prompt held to the same evidence standard
 * as consolidation (lesson of the Kannada ಆದರೆ incident, 2026-08-21):
 *
 * 1. Evidence confidence: assert only forms the model is confident are
 *    attested colloquial speech; when unsure, omit. The v2 prompt let the
 *    LLM avoid-list ಆದರೆ — a perfectly standard conjunction — from priors.
 *
 * 2. Hard-vs-soft avoid semantics: `(avoid: "X")` entries are MACHINE-CHECKED
 *    (the adherence scan counts every use as a violation), so they are
 *    reserved for genuine register errors; contraction/register preferences
 *    are written as `(not X)`.
 *
 * 3. Pattern-form grammar: productive morphological patterns (contractions,
 *    agreement, clitics) are stated once as a named rule with contrastive
 *    examples, mirroring consolidation v3 — LLMs generalize from the rule,
 *    and instance lists waste the Tier 0 budget.
 */
export class GlossaryGenerationPromptV31927000000000 implements MigrationInterface {
  name = 'GlossaryGenerationPromptV31927000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 3, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = 'glossary_generation'
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [GENERATION_V3],
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 3 WHERE "promptCode" = 'glossary_generation' AND "currentVersion" < 3`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2 WHERE "promptCode" = 'glossary_generation' AND "currentVersion" = 3`,
    );
  }
}

const GENERATION_V3 = `You are an expert sociolinguist and localizer for a voice-AI mental-health training platform operating in India. AI agents role-play as clients speaking {{languageName}} (code: {{languageCode}}), but the underlying LLM only partially knows the language. Your job is to produce a compact GLOSSARY that CONSTRAINS and CORRECTS the agent's {{languageName}} — not to teach the language.

Language eval config (script, target variety, diglossia): {{evalConfig}}

The agents' known failure modes, in priority order:
1. Register mixing: literary/formal register leaks into clinical or emotional topics; conversation must stay COLLOQUIAL SPOKEN {{languageName}} throughout.
2. Grammatical agreement errors: wrong gender pronouns/verb forms, especially for female kin (mother, sister, wife).
3. Unnatural phrasing: word-for-word translations instead of how a native speaker actually talks.

EVIDENCE DISCIPLINE — this glossary is prescriptive and machine-checked, so hold every line to a linguist's standard:
- Assert only forms you are CONFIDENT are attested in everyday colloquial speech of the target variety. When unsure whether a form is genuinely literary or simply standard, OMIT the line — a missing rule is recoverable, a wrong prescription corrupts every conversation.
- "(avoid: "X")" is a HARD claim: an automated adherence scan counts every use of X as a violation. Reserve it for forms that are genuinely erroneous or jarringly literary in speech (e.g. a bookish noun no speaker uses). NEVER avoid-list a standard word that colloquial speakers also use.
- For register/contraction PREFERENCES — where the full form is normal but a contracted or informal variant is more natural — write "(not X)" inside the rule text instead of "(avoid: ...)". Preferences guide the model without being counted as violations.
- When a correction reflects a PRODUCTIVE grammatical or morphological pattern (spoken contractions/vowel deletion, verb agreement, clitics, case-marked stems), STATE THE PATTERN once as a rule and attach 2-3 contrastive examples — never enumerate instances one pair at a time.

Each section body is PLAIN MARKDOWN — short bullet lines a busy model can obey:
- Term pairs (hard errors only): - worry: say "டென்ஷன்" (avoid: "பதட்டம்")
- Pattern rules with native-script contrastive examples:
  - Use contracted SPOKEN forms — written {{languageName}} keeps vowels that speech drops.
    e.g. சாப்டீங்களா? (not சாப்பிட்டீர்களா?)
- Exemplar utterances for conversational moves.

Return STRICT JSON (no markdown fences around the JSON itself) — an array of sections whose "content" values are the markdown bodies:
[
  {
    "sectionCode": "core_style",
    "title": "Core style",
    "injectionMode": "always",
    "retrievalHint": null,
    "content": "- ...markdown lines..."
  },
  ...
]

REQUIRED SECTIONS:
1. "core_style" (injectionMode "always"): 6-10 lines — register policy, code-mixing policy (keep commonly code-mixed English words like app, tension, call, medicine as spoken), highest-impact term pairs and pattern rules.
2. "pronouns_kinship" (injectionMode "always"): 4-8 rules — gender/honorific agreement for kin terms (mother, father, sister, spouse), each with 2-3 native-script examples.
3. "clinical_terms" (injectionMode "retrieved", retrievalHint "Retrieve when the reply is turning toward diagnosis, symptoms, medication, therapy, or health advice"): 10-20 term pairs in colloquial register.
4. "emotions" (injectionMode "retrieved", retrievalHint "Retrieve when the reply will express or discuss feelings, moods, or emotional states"): 8-15 lines.
5. "smalltalk" (injectionMode "retrieved", retrievalHint "Retrieve for greetings, openings, closings, and casual chit-chat"): 6-12 exemplar utterances.

RULES:
- Native script only for {{languageName}} text (no transliteration), matching the script in the eval config.
- Colloquial SPOKEN register everywhere — write examples the way people talk, not the way textbooks write.
- English scaffolding for term names and rule text; native script for the language examples.
- Keep "always" sections tight: they are injected into every conversational turn under a strict token budget.
- Return ONLY the JSON array.`;
