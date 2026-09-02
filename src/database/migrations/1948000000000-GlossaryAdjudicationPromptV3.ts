import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adjudication prompt v3 — corrects a false premise in v2.
 *
 * v2 told the adjudicator:
 *
 *   "a wrong accept is recoverable (rules are versioned and revertible) while
 *    a wrong reject loses only one proposal, which the loop will re-derive if
 *    the evidence persists"
 *
 * The second half is wrong, and it biased the model toward the IRREVERSIBLE
 * action. `rejectProposal` keeps the entry at status 'rejected' precisely so
 * its annotations stay in the consumed-set — that is deliberate, it stops a
 * rejected rule being re-proposed every cycle. The consequence is that the
 * loop will NEVER re-derive it: a wrong reject permanently loses that rule,
 * while a wrong accept is revertible via the batch record.
 *
 * Observed on the first real apply-mode verdicts (2026-09-02, Tamil): 3
 * accepts and 2 rejects, of which one reject cited a restatement that is not
 * in the published content or the batch. Under v2's premise the model believed
 * that mistake was cheap. It was not.
 *
 * v3 states the asymmetry correctly and gives the model somewhere safe to put
 * genuine uncertainty: OMIT, which holds the proposal for later, rather than
 * reject, which discards it for good. It still pushes for decisiveness —
 * a queue that never clears is worthless — but the escape hatch now points at
 * the reversible option instead of the permanent one.
 *
 * Also fixes a smaller audit problem: v2's reasons cited rules as being in the
 * "awaiting review" section when they were in published content, because the
 * glossary summary labels pending entries but not content lines. v3 asks for
 * the quoted rule instead of a section name, so a verdict can be checked.
 */
export class GlossaryAdjudicationPromptV31948000000000 implements MigrationInterface {
  name = 'GlossaryAdjudicationPromptV31948000000000';

  private readonly code = 'glossary_adjudication';

  private readonly template = `You decide whether proposed rules enter the {{languageName}} ({{languageCode}}) glossary.

Nobody reviews these by hand. Your verdicts are applied immediately.

THE ASYMMETRY THAT SHOULD SHAPE YOUR CHOICES
A wrong ACCEPT is recoverable: every accepted rule is recorded in a batch that can be rolled back, and the rule is versioned.
A wrong REJECT is PERMANENT. Rejecting a proposal consumes the evidence behind it, so the loop will never propose that rule again. Nothing re-derives it.
Therefore: be decisive, but never reject to resolve your own uncertainty. If you genuinely cannot tell whether a proposal is good, OMIT it — omitted proposals are held and can be decided later. Reject only when you can name the specific reason below that applies.

WHAT THE GLOSSARY IS
It is injected into a role-play agent's system prompt on EVERY TURN, inside a fixed budget of about 2000 tokens for the whole language. A rule earns its place only if it changes what the agent SAYS in {{languageName}}. Everything else is a tax on every turn.

THE EXISTING GLOSSARY — already in the prompt:
{{existingGlossary}}

PROPOSALS — each carries [section, mode, support, form]:
{{proposals}}

WHAT "form" MEANS, AND WHY IT MATTERS
Measured on the live Kannada glossary: rules whose opening line named both the form to use and the form to avoid were followed 100% of the time (35 uses of the prescribed word, 0 of the proscribed). The identical substitution, demoted to a shared "e.g." line beneath an abstract statement ("written Kannada keeps vowels that speech drops — apply it everywhere"), was followed 4% of the time (10 vs 245), and in one case 0% (0 vs 14). Same prompt, same section. An abstract rule is not a cheap rule; it is an ineffective one that still spends the budget.

  form=canonical             opening line names both forms. Good shape.
  form=pair_only_in_example  opening line names no concrete term and the pair
                             hides in an example. This is the 4% shape —
                             prefer to REWRITE it (see below) rather than
                             reject, when the substance is sound.
  form=no_substitution       no form to avoid at all. Usually prose guidance;
                             judge it on substance, not shape.

REJECT a proposal only when you can name one of these:

1. NOT A LANGUAGE RULE. Persona, role-play or conversational-behaviour direction — "do not break character", "let the counsellor lead", "avoid numbered lists", "do not direct the conversation", "generate a plausible fictional answer". These are real problems, but a per-language glossary cannot fix them; they belong in the persona prompt. This was the single largest category of bad proposals.
2. WRONG LANGUAGE. The rule must be about {{languageName}}. A rule about another language's grammar or lexicon arrived by mistake — reject it even if it is correct about that other language.
3. RESTATES a rule already present above, or another proposal in this batch. You must QUOTE the rule it restates in your reason. If you cannot quote it, this reason does not apply — do not use it as a general suspicion. Note also: a rule that is already present and still being broken does not need restating; that was measured, where the most-violated Kannada rule was correct, present, and ignored 96% of the time.
4. FORBIDS A WORD REAL SPEAKERS USE. If the avoided term is ordinary current usage in this variety rather than a formal, literary or translated form, the rule fights the population and will be ignored.
5. SCOPED TO ONE SCENARIO OR PERSONA. A glossary rule applies to every session in {{languageName}}. A rule premised on a particular persona ("the persona is a peer, so use the informal pronoun") does not generalise — reject it unless the claim holds for the language as a whole.
6. TOO VAGUE TO CHECK. No concrete form to prefer and none to avoid, and no rewrite could give it one.

ACCEPT otherwise. The proposal to accept names a colloquial or natural form to use and a formal, literary or calqued form to avoid, for something the agent actually gets wrong, and is not already covered.

REWRITE when the substance is good but the shape is not. Return verdict "accept" together with a "rewrite" field holding the rule restated as one line in the glossary's own style — "- <meaning>: say \`<use>\` (avoid: \`<avoid>\`)" — keeping the original script and adding nothing new. Use the existing lines above as your model. Omit "rewrite" when the proposal is already fine.

Do not weigh "support" as correctness. It counts how many annotations clustered, not whether the rule is right; a high-support proposal can still be actor behaviour or a restatement.

Return ONLY a JSON array, no prose, no markdown fence:

[{"index": 1, "verdict": "accept", "reason": "<short clause>"},
 {"index": 2, "verdict": "reject", "reason": "<reason number + what applies; for 3, quote the rule restated>"},
 {"index": 3, "verdict": "accept", "reason": "<short clause>", "rewrite": "- <meaning>: say \`X\` (avoid: \`Y\`)"}]

Decide every proposal you can. Omit only those you genuinely cannot judge — an omission is held, a rejection is final.`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT p."id", 3, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
      [this.template, this.code],
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 3
        WHERE "promptCode" = $1 AND "currentVersion" < 3`,
      [this.code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2
        WHERE "promptCode" = $1 AND "currentVersion" = 3`,
      [this.code],
    );
  }
}
