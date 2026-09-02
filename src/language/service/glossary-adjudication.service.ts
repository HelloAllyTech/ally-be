import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import {
  GLOSSARY_ADJUDICATION_BATCH,
  GLOSSARY_ADJUDICATION_PROMPT_CODE,
} from '../constants/glossary.constants';
import {
  GlossaryEntryStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';
import { LanguageGlossaryRepository } from '../repository/language-glossary.repository';
import { classifyRuleForm } from '../util/glossary-rule-form.util';
import { LanguageGlossaryService } from './language-glossary.service';

export type AdjudicationVerdict = 'accepted' | 'rejected' | 'deferred';

export interface AdjudicatedProposal {
  sectionCode: string;
  profileId: string | null;
  entryId: string;
  verdict: AdjudicationVerdict;
  /** Why — recorded so a wrong call is diagnosable without a re-run. */
  reason: string;
}

export interface AdjudicateResult {
  considered: number;
  accepted: number;
  rejected: number;
  deferred: number;
  proposals: AdjudicatedProposal[];
}

interface QueuedProposal {
  sectionCode: string;
  profileId: string | null;
  entryId: string;
  markdown: string;
  injectionMode: string;
  support: number;
}

/**
 * Decides the proposal queue, because nobody else can.
 *
 * The glossary's review step assumed a human reviewer who reads Tamil,
 * Kannada, Hindi and Marathi. There is no such reviewer, so `propose` mode
 * means the queue grows forever and the loop achieves nothing — while `auto`
 * mode published whatever the consolidator produced. Reviewing the first real
 * queue by hand on 2026-09-02 showed why neither is acceptable: of 51
 * proposals, 20 had to be rejected, and two of the categories were things a
 * machine can judge reliably.
 *
 * What that review found, and what this pass therefore checks:
 *
 *   - 9 English + 3 Hindi proposals were ACTOR BEHAVIOUR, not language:
 *     "do not break character", "avoid numbered lists", "let the counsellor
 *     lead". Real signal, wrong container — a language glossary is injected
 *     per language, and these belong in the agent prompt. Biggest single
 *     category, and a judgement an LLM makes well.
 *   - 8 were in the WRONG LANGUAGE entirely (Tamil rules under en-IN), from
 *     foreign-script evidence. Now prevented upstream by
 *     `excludeForeignScripts`, so this pass should never see them again.
 *   - Non-binding FORM is checked deterministically before any model call:
 *     a rule whose substitution is buried in an example line measured 4%
 *     compliance against 100% for the canonical one-liner, so publishing it
 *     spends Tier 0 tokens and changes nothing. See
 *     {@link classifyRuleForm}.
 *
 * Tier 0 pressure is real and is reported, not fought: accepting into a
 * published `always` section can breach the token cap, and the cap is
 * authoritative. Such a proposal is DEFERRED with its reason rather than
 * retried or forced — Tamil sat at 1,996 of 2,000 tokens with 14 good
 * proposals queued, and the answer there is re-tiering or trimming, not
 * squeezing.
 */
@Injectable()
export class GlossaryAdjudicationService {
  private readonly logger = new Logger(GlossaryAdjudicationService.name);

  constructor(
    private readonly glossaryService: LanguageGlossaryService,
    private readonly glossaryRepository: LanguageGlossaryRepository,
    private readonly llmProviderFactory: LlmProviderFactory,
  ) {}

  /** Everything still awaiting a decision, from an already-loaded section set. */
  private queuedProposals(
    sections: LanguageGlossarySection[],
  ): QueuedProposal[] {
    const queued: QueuedProposal[] = [];
    for (const section of sections) {
      for (const entry of section.entries ?? []) {
        if (entry.status !== GlossaryEntryStatus.PROPOSED) continue;
        queued.push({
          sectionCode: section.sectionCode,
          profileId: section.profileId ?? null,
          entryId: entry.id,
          markdown: entry.markdown ?? '',
          injectionMode: section.injectionMode,
          support: entry.provenance?.annotationIds?.length ?? 0,
        });
      }
    }
    return queued;
  }

  /**
   * Adjudicate one language's queue.
   *
   * `apply: false` returns the verdicts without touching anything — the way
   * to see what the pass would do before letting it do it.
   */
  async adjudicateLanguage(
    languageId: number,
    options: { apply?: boolean; adjudicatedBy?: string } = {},
  ): Promise<AdjudicateResult> {
    const apply = options.apply !== false;
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);
    const queued = this.queuedProposals(sections);
    const empty: AdjudicateResult = {
      considered: 0,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      proposals: [],
    };
    if (queued.length === 0) return empty;

    const decided = new Map<
      string,
      { verdict: AdjudicationVerdict; reason: string; rewrite?: string }
    >();

    // Form is ANNOTATED, not vetoed. It used to auto-reject the buried-pair
    // shape before any model call, and a dry run on production then rejected
    // all six queued proposals — every one legitimate — because a regex
    // cannot tell an abstract opener from a substitution stated in prose. A
    // deterministic pre-veto fails silently and totally; the adjudicator's
    // reasoning is at least inspectable. So the classification travels to the
    // model as evidence and the model rules.
    const modelVerdicts = await this.adjudicateWithModel(
      languageId,
      sections,
      queued,
    );
    for (const [entryId, v] of modelVerdicts) decided.set(entryId, v);

    const proposals: AdjudicatedProposal[] = [];
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;

    for (const p of queued) {
      const decision = decided.get(p.entryId) ?? {
        verdict: 'deferred' as AdjudicationVerdict,
        reason: 'adjudicator returned no verdict for this proposal',
      };
      let { verdict, reason } = decision;

      if (apply && verdict === 'accepted') {
        try {
          if (decision.rewrite) {
            await this.rewriteProposal(languageId, p, decision.rewrite);
            reason = `${reason} (rewritten to canonical form)`;
          }
          await this.acceptMakingRoomIfNeeded(languageId, p, options);
        } catch (error) {
          // The cap still wins after re-tiering. Report, never force: the
          // remaining answers are raising the cap or trimming content, and
          // both are decisions, not retries.
          verdict = 'deferred';
          reason =
            error instanceof BadRequestException
              ? `deferred: ${(error as Error).message}`
              : `deferred: accept failed — ${(error as Error).message}`;
        }
      } else if (apply && verdict === 'rejected') {
        await this.glossaryService.rejectProposal(
          languageId,
          p.sectionCode,
          p.entryId,
          options.adjudicatedBy ?? 'adjudicator',
          p.profileId,
        );
      }

      if (verdict === 'accepted') accepted++;
      else if (verdict === 'rejected') rejected++;
      else deferred++;
      proposals.push({
        sectionCode: p.sectionCode,
        profileId: p.profileId,
        entryId: p.entryId,
        verdict,
        reason,
      });
    }

    this.logger.log(
      `[GLOSSARY_ADJUDICATE] language=${languageId} apply=${apply} ` +
        `considered=${queued.length} accepted=${accepted} rejected=${rejected} deferred=${deferred}`,
    );
    return {
      considered: queued.length,
      accepted,
      rejected,
      deferred,
      proposals,
    };
  }

  /**
   * Replace a proposal's text with the adjudicator's canonical rewrite.
   *
   * The alternative to rewriting is rejecting substance for shape: a genuine
   * substitution buried under an abstract opener is worth keeping, it just has
   * to be restated in the form the agent actually follows (100% vs 4%
   * compliance). Only the entry's markdown changes — provenance, support and
   * id are untouched, so the rule stays traceable to the annotations that
   * produced it.
   */
  private async rewriteProposal(
    languageId: number,
    p: QueuedProposal,
    rewrite: string,
  ): Promise<void> {
    const section = await this.glossaryRepository.findSection(
      languageId,
      p.sectionCode,
      p.profileId,
    );
    const entry = section?.entries?.find((e) => e.id === p.entryId);
    if (!section || !entry) return;
    entry.markdown = rewrite;
    await this.glossaryRepository.save(section);
    this.logger.log(
      `[GLOSSARY_ADJUDICATE] language=${languageId} rewrote ${p.sectionCode}/${p.entryId} to canonical form`,
    );
  }

  /**
   * Accept a proposal, re-tiering once if the Tier 0 cap is what blocks it.
   *
   * Deferring on the cap alone was a dead end: a good rule would sit in the
   * queue forever while a mechanism to reallocate the budget went unused. The
   * computed pass ranks sections by value per token and demotes the weakest to
   * `retrieved` — on-demand rather than every-turn, which is where a rule that
   * cannot pay for a permanent slot belongs.
   *
   * Re-tiered at most once per accept, and only after a cap failure, so a
   * language whose allocation is already optimal pays nothing. If the cap
   * still refuses, the error propagates: what remains is raising the cap or
   * trimming content, and those are decisions rather than retries.
   */
  private async acceptMakingRoomIfNeeded(
    languageId: number,
    p: QueuedProposal,
    options: { adjudicatedBy?: string },
  ): Promise<void> {
    const by = options.adjudicatedBy ?? 'adjudicator';
    try {
      await this.glossaryService.acceptProposal(
        languageId,
        p.sectionCode,
        p.entryId,
        by,
        p.profileId,
      );
      return;
    } catch (error) {
      const isCap =
        error instanceof BadRequestException &&
        /token/i.test((error as Error).message);
      if (!isCap) throw error;
    }

    const retier = await this.glossaryService.retierGlossary(languageId, {
      apply: true,
    });
    const changed = retier.views.some(
      (v) => v.promoted.length > 0 || v.demoted.length > 0,
    );
    this.logger.log(
      `[GLOSSARY_ADJUDICATE] language=${languageId} cap blocked ${p.sectionCode} — ` +
        `re-tier ${changed ? 'freed space, retrying' : 'proposed no change'}`,
    );
    // Retry regardless of `changed`: the surviving error is the honest signal
    // to the caller, and it names the cap.
    await this.glossaryService.acceptProposal(
      languageId,
      p.sectionCode,
      p.entryId,
      by,
      p.profileId,
    );
  }

  /** One adjudication call per batch; unparseable output defers, never guesses. */
  private async adjudicateWithModel(
    languageId: number,
    sections: LanguageGlossarySection[],
    proposals: QueuedProposal[],
  ): Promise<
    Map<
      string,
      { verdict: AdjudicationVerdict; reason: string; rewrite?: string }
    >
  > {
    const out = new Map<
      string,
      { verdict: AdjudicationVerdict; reason: string; rewrite?: string }
    >();
    const language =
      await this.glossaryService.assertLanguageExists(languageId);
    const { systemPrompt, engine } =
      await this.glossaryService.resolvePromptByCode(
        GLOSSARY_ADJUDICATION_PROMPT_CODE,
      );
    const existing = this.glossaryService.summarizeGlossary(sections);
    const provider = this.llmProviderFactory.getProvider(engine.provider);

    for (let i = 0; i < proposals.length; i += GLOSSARY_ADJUDICATION_BATCH) {
      const batch = proposals.slice(i, i + GLOSSARY_ADJUDICATION_BATCH);
      const listing = batch
        .map(
          (p, n) =>
            `${n + 1}. [section=${p.sectionCode}${p.profileId ? '@overlay' : ''} ` +
            `mode=${p.injectionMode} support=${p.support} ` +
            `form=${classifyRuleForm(p.markdown)}]\n${p.markdown}`,
        )
        .join('\n\n');
      const filled = systemPrompt
        .split('{{languageName}}')
        .join(language.label)
        .split('{{languageCode}}')
        .join(language.value)
        .split('{{existingGlossary}}')
        .join(existing)
        .split('{{proposals}}')
        .join(listing);

      let raw: string;
      try {
        raw = await provider.getCompletion(
          [
            { role: 'system', content: filled },
            {
              role: 'user',
              content: `Adjudicate the ${batch.length} proposal(s) for ${language.label} (${language.value}).`,
            },
          ],
          {
            model: engine.model,
            temperature: engine.temperature,
            maxTokens: engine.maxTokens,
          },
        );
      } catch (error) {
        this.logger.warn(
          `[GLOSSARY_ADJUDICATE] language=${languageId} model call failed: ${(error as Error).message}`,
        );
        continue; // leaves the batch undecided -> deferred, never auto-accepted
      }

      for (const v of this.parseVerdicts(raw)) {
        const target = batch[v.index - 1];
        if (!target) continue;
        out.set(target.entryId, {
          verdict: v.verdict,
          reason: v.reason,
          rewrite: v.rewrite,
        });
      }
    }
    return out;
  }

  /**
   * Parse the adjudicator's output, tolerating markdown fences.
   *
   * A proposal the model did not rule on is deliberately left out of the map,
   * so it defers. Silence must never read as approval.
   */
  private parseVerdicts(raw: string): {
    index: number;
    verdict: AdjudicationVerdict;
    reason: string;
    rewrite?: string;
  }[] {
    const cleaned = (raw ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(
        '[GLOSSARY_ADJUDICATE] unparseable adjudicator output — batch deferred',
      );
      return [];
    }
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { verdicts?: unknown[] })?.verdicts ?? []);
    if (!Array.isArray(list)) return [];
    const out: {
      index: number;
      verdict: AdjudicationVerdict;
      reason: string;
      rewrite?: string;
    }[] = [];
    for (const item of list) {
      const row = item as {
        index?: unknown;
        verdict?: unknown;
        reason?: unknown;
        rewrite?: unknown;
      };
      const index = Number(row.index);
      const verdict = String(row.verdict ?? '').toLowerCase();
      if (!Number.isFinite(index)) continue;
      if (verdict !== 'accept' && verdict !== 'reject') continue;
      const rewrite =
        typeof row.rewrite === 'string' && row.rewrite.trim()
          ? row.rewrite.trim().slice(0, 600)
          : undefined;
      out.push({
        index,
        verdict: verdict === 'accept' ? 'accepted' : 'rejected',
        reason: String(row.reason ?? '').slice(0, 300),
        // A rewrite only means anything on an accept.
        rewrite: verdict === 'accept' ? rewrite : undefined,
      });
    }
    return out;
  }
}
