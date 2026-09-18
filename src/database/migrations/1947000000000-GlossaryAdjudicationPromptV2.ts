import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adjudication prompt v2 — the version that runs unattended.
 *
 * v1 leaned on a deterministic pre-veto for rule form. That veto rejected all
 * six queued production proposals in a dry run (2026-09-02), every one
 * legitimate, because a regex cannot separate an abstract opener from a
 * substitution stated in prose. Form now reaches the model as an annotation
 * (`form=canonical | pair_only_in_example | no_substitution`) and the model
 * rules on it, so a wrong call is visible in a reason string instead of
 * silently vetoing the queue.
 *
 * Every criterion below is a category this session had to decide by hand,
 * with the count that made it worth encoding:
 *
 *   12 of 51  actor behaviour, not language ("do not break character",
 *             "avoid numbered lists", "let the counsellor lead")
 *    8 of 51  wrong language entirely (Tamil rules filed under en-IN)
 *    2        near-duplicates of each other that dedupe missed
 *    1        held by hand: a rule baking a persona assumption ("the persona
 *             is a peer") into a glossary applied to every scenario
 *
 * Plus the two measured facts the model cannot infer from the proposal text:
 * the 4%-vs-100% compliance gap between buried and stated substitutions, and
 * that Kannada's most-violated rule was a correct rule the agent ignored 96%
 * of the time — so a rule already in the glossary being violated is NOT
 * evidence to restate it.
 */
export class GlossaryAdjudicationPromptV21947000000000 implements MigrationInterface {
  name = 'GlossaryAdjudicationPromptV21947000000000';

  private readonly code = 'glossary_adjudication';

  private readonly template = `You decide whether proposed rules enter the {{languageName}} ({{languageCode}}) glossary.

Nobody reviews these by hand. Your verdicts are applied. Be decisive: a queue that never clears is worth nothing, and a wrong accept is recoverable (rules are versioned and revertible) while a wrong reject loses only one proposal, which the loop will re-derive if the evidence persists.

WHAT THE GLOSSARY IS
It is injected into a role-play agent's system prompt on EVERY TURN, inside a fixed token budget of about 2000 tokens for the whole language. A rule earns its place only if it changes what the agent SAYS in {{languageName}}. Everything else is a tax on every turn.

THE EXISTING GLOSSARY — already in the prompt:
{{existingGlossary}}

PROPOSALS — each carries [section, mode, support, form]:
{{proposals}}

WHAT "form" MEANS, AND WHY IT MATTERS
Measured on the live Kannada glossary: rules whose opening line named both the form to use and the form to avoid were followed 100% of the time (35 uses of the prescribed word, 0 of the proscribed). The identical substitution, demoted to a shared "e.g." line beneath an abstract statement ("written Kannada keeps vowels that speech drops — apply it everywhere"), was followed 4% of the time (10 vs 245) and in one case 0% (0 vs 14). Same prompt, same section. An abstract rule is not a cheap rule; it is an ineffective one that still spends the budget.

  form=canonical             opening line names both forms. Good shape.
  form=pair_only_in_example  opening line names no concrete term and the pair
                             hides in an example. This is the 4% shape —
                             reject it, or accept ONLY if you rewrite it (see
                             "rewrite" below).
  form=no_substitution       no form to avoid at all. Usually prose guidance;
                             judge it on substance, not shape.

REJECT a proposal when any of these hold:

1. NOT A LANGUAGE RULE. Persona, role-play or conversational-behaviour direction — "do not break character", "let the counsellor lead", "avoid numbered lists", "do not direct the conversation", "generate a plausible fictional answer". These are real problems, but a per-language glossary cannot fix them; they belong in the persona prompt. This was the single largest category of bad proposals.
2. WRONG LANGUAGE. The rule must be about {{languageName}}. A rule about another language's grammar or lexicon arrived by mistake — reject it even if it is correct about that other language.
3. RESTATES something already in the glossary above, or another proposal in this batch, in any wording. Note carefully: if a rule is ALREADY in the glossary and the agent keeps breaking it, restating it does not help. That was measured — Kannada's most-violated rule was correct and present, and the agent ignored it 96% of the time. Reject the restatement.
4. FORBIDS A WORD REAL SPEAKERS USE. If the avoided term is ordinary current usage in this variety rather than a formal, literary or translated form, the rule fights the population and will be ignored.
5. SCOPED TO ONE SCENARIO OR PERSONA. A glossary rule applies to every session in {{languageName}}. A rule premised on a particular persona ("the persona is a peer, so use the informal pronoun") does not generalise — reject it unless the claim holds for the language as a whole.
6. TOO VAGUE TO CHECK. No concrete form to prefer and none to avoid.

ACCEPT otherwise. The proposal to accept names a colloquial or natural form to use and a formal, literary or calqued form to avoid, for something the agent actually gets wrong, and it is not already covered.

REWRITE when the substance is good but the shape is not. If a form=pair_only_in_example proposal contains a genuine, generalisable substitution, you may return verdict "accept" together with a "rewrite" field holding the rule restated as one line in the glossary's own style — "- <meaning>: say \`<use>\` (avoid: \`<avoid>\`)" — keeping the original script and adding nothing new. Use the language's existing lines above as the model. Omit "rewrite" when the proposal is already fine.

Do not weigh "support" as correctness. It counts how many annotations clustered, not whether the rule is right; a high-support proposal can still be actor behaviour or a restatement.

Return ONLY a JSON array, no prose, no markdown fence:

[{"index": 1, "verdict": "accept", "reason": "<short clause>"},
 {"index": 2, "verdict": "reject", "reason": "<short clause naming the rule number above>"},
 {"index": 3, "verdict": "accept", "reason": "<short clause>", "rewrite": "- <meaning>: say \`X\` (avoid: \`Y\`)"}]

Every proposal must appear exactly once. If you genuinely cannot decide one, omit it — an omitted proposal is held rather than guessed at, and that is a safe outcome. Do not omit merely because a proposal is borderline; decide it.`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 2, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [this.template, this.code],
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2
        WHERE "promptCode" = $1 AND "currentVersion" < 2`,
      [this.code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1
        WHERE "promptCode" = $1 AND "currentVersion" = 2`,
      [this.code],
    );
  }
}
