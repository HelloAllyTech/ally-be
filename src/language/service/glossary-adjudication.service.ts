import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import {
  GLOSSARY_ADJUDICATION_BATCH,
  GLOSSARY_ADJUDICATION_PROMPT_CODE,
  GLOSSARY_DEFER_BACKOFF_MAX_HOURS,
  GLOSSARY_REJECT_VOTES_REQUIRED,
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
  /** Consecutive reject votes already recorded on this entry. */
  rejectVotes: number;
  /** Consecutive deferrals for the same reason, and when the last one was. */
  deferrals: number;
  lastDeferredAt: string | null;
  lastDeferReason: string | null;
}

/**
 * Reason identity for backoff purposes: digits stripped, so a cap breach
 * reported as "2065/2000" and later "2071/2000" counts as the SAME reason and
 * keeps backing off, while a genuinely different cause resets the clock.
 */
export const deferReasonKey = (reason: string | null | undefined): string =>
  (reason ?? '').replace(/\d+/g, '#').slice(0, 300);

/** Hours to wait after the Nth consecutive deferral: 1, 2, 4, 8 … capped. */
export const deferBackoffHours = (deferrals: number): number =>
  Math.min(2 ** Math.max(0, deferrals - 1), GLOSSARY_DEFER_BACKOFF_MAX_HOURS);

/** True when this proposal is still inside its post-deferral wait. */
const withinBackoff = (p: QueuedProposal, now: number): boolean => {
  if (p.deferrals <= 0 || !p.lastDeferredAt) return false;
  const last = Date.parse(p.lastDeferredAt);
  if (Number.isNaN(last)) return false;
  return now - last < deferBackoffHours(p.deferrals) * 3_600_000;
};

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
 *   - Rule FORM is ANNOTATED for the model, not vetoed before it. A first cut
 *     auto-rejected the buried-pair shape and a production dry run then
 *     rejected all six queued proposals, every one legitimate: a regex cannot
 *     tell an abstract opener from a substitution stated in prose. See
 *     {@link classifyRuleForm}.
 *
 * REJECTS NEED TWO CONSECUTIVE VOTES. Rejecting consumes a proposal's
 * annotations, so nothing re-derives the rule — a reject is permanent, while
 * an accept is revertible through the batch record. The adjudicator is not
 * consistent enough to be handed that asymmetry on one reading: the same Tamil
 * proposal was accepted at 15:00 and rejected at 16:00 on identical input,
 * both verdicts defensible. A clear-cut reject repeats across passes; a
 * coin-flip does not, and lands in `deferred` instead of being destroyed.
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

  /**
   * Everything still awaiting a decision, from an already-loaded section set.
   *
   * With `respectBackoff`, proposals still inside their post-deferral wait are
   * withheld — they stay queued and visible, they are just not re-sent to the
   * model at a rate that cannot pay off. The scheduler uses this; an admin
   * hitting the endpoint by hand does not, because a human asking explicitly
   * should get an answer now.
   */
  private queuedProposals(
    sections: LanguageGlossarySection[],
    respectBackoff = false,
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
          rejectVotes: entry.adjudication?.rejectVotes ?? 0,
          deferrals: entry.adjudication?.deferrals ?? 0,
          lastDeferredAt: entry.adjudication?.lastDeferredAt ?? null,
          lastDeferReason: entry.adjudication?.lastDeferReason ?? null,
        });
      }
    }
    if (!respectBackoff) return queued;
    const now = Date.now();
    const ready = queued.filter((p) => !withinBackoff(p, now));
    const withheld = queued.length - ready.length;
    if (withheld > 0) {
      this.logger.log(
        `[GLOSSARY_ADJUDICATE] ${withheld} proposal(s) withheld by defer backoff`,
      );
    }
    return ready;
  }

  /**
   * Adjudicate one language's queue.
   *
   * `apply: false` returns the verdicts without touching anything — the way
   * to see what the pass would do before letting it do it.
   */
  async adjudicateLanguage(
    languageId: number,
    options: {
      apply?: boolean;
      adjudicatedBy?: string;
      /** Withhold proposals still inside their post-deferral wait. */
      respectBackoff?: boolean;
    } = {},
  ): Promise<AdjudicateResult> {
    const apply = options.apply !== false;
    const sections =
      await this.glossaryRepository.findAllForLanguage(languageId);
    const queued = this.queuedProposals(
      sections,
      options.respectBackoff === true,
    );
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
          // An accept ends any reject streak: the votes must be CONSECUTIVE.
          await this.recordRejectVote(languageId, p, null);
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
          // This branch mutates verdict away from 'accepted' after the
          // if/else-if chain below has already been decided against the
          // pre-mutation value, so the `apply && verdict === 'deferred'`
          // branch that normally calls recordDeferral is never reached for
          // this case — it has to happen here instead, or this proposal's
          // deferral streak never advances and defer backoff never kicks in.
          await this.recordDeferral(languageId, p, reason);
        }
      } else if (apply && verdict === 'rejected') {
        // Two consecutive passes must agree before a permanent reject lands.
        const votes = (p.rejectVotes ?? 0) + 1;
        if (votes >= GLOSSARY_REJECT_VOTES_REQUIRED) {
          await this.glossaryService.rejectProposal(
            languageId,
            p.sectionCode,
            p.entryId,
            options.adjudicatedBy ?? 'adjudicator',
            p.profileId,
          );
          reason = `${reason} [confirmed on ${votes} consecutive passes]`;
        } else {
          await this.recordRejectVote(languageId, p, reason);
          verdict = 'deferred';
          reason =
            `held for a second opinion (${votes}/${GLOSSARY_REJECT_VOTES_REQUIRED} ` +
            `reject votes): ${reason}`;
        }
      } else if (apply && verdict === 'deferred') {
        // A deferral is not agreement to reject either — but it IS worth
        // remembering, so an unchangeable verdict is not re-billed hourly.
        await this.recordDeferral(languageId, p, reason);
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
   * Record (or clear) a proposal's consecutive reject-vote count.
   *
   * `reason === null` clears the streak, which any non-reject verdict must do
   * — the votes only mean something if they are consecutive. Stored on the
   * entry itself so the state survives restarts and is visible to anyone
   * reading the section, rather than living in a process-local cache that two
   * replicas would disagree about.
   */
  private async recordRejectVote(
    languageId: number,
    p: QueuedProposal,
    reason: string | null,
  ): Promise<void> {
    // Nothing to clear: avoid a pointless write on the common path.
    if (reason === null && (p.rejectVotes ?? 0) === 0) return;
    const section = await this.glossaryRepository.findSection(
      languageId,
      p.sectionCode,
      p.profileId,
    );
    const entry = section?.entries?.find((e) => e.id === p.entryId);
    if (!section || !entry) return;
    // Deferral history is PRESERVED across a reject-streak reset. The two
    // counters answer different questions — "is this reject consistent?" and
    // "how long until re-asking is worth it?" — and clearing the whole object
    // let an accept that later failed the cap reset a backoff it never
    // decided anything about.
    const defer =
      entry.adjudication?.deferrals === undefined
        ? {}
        : {
            deferrals: entry.adjudication.deferrals,
            lastDeferredAt: entry.adjudication.lastDeferredAt,
            lastDeferReason: entry.adjudication.lastDeferReason,
          };
    entry.adjudication =
      reason === null
        ? { rejectVotes: 0, ...defer }
        : {
            rejectVotes: (p.rejectVotes ?? 0) + 1,
            lastRejectReason: reason.slice(0, 300),
            lastRejectAt: new Date().toISOString(),
            ...defer,
          };
    await this.glossaryRepository.save(section);
  }

  /**
   * Record a deferral so the same unchangeable verdict is not re-billed every
   * hour. Consecutive deferrals for the SAME reason double the wait
   * (capped at GLOSSARY_DEFER_BACKOFF_MAX_HOURS); a different reason resets
   * the streak, so a transient provider error retries within the hour while a
   * Tier 0 cap breach settles to weekly.
   *
   * A deferral also ends any reject streak — it is not agreement to reject.
   */
  private async recordDeferral(
    languageId: number,
    p: QueuedProposal,
    reason: string,
  ): Promise<void> {
    const section = await this.glossaryRepository.findSection(
      languageId,
      p.sectionCode,
      p.profileId,
    );
    const entry = section?.entries?.find((e) => e.id === p.entryId);
    if (!section || !entry) return;
    const key = deferReasonKey(reason);
    const same = key === deferReasonKey(p.lastDeferReason);
    entry.adjudication = {
      rejectVotes: 0,
      deferrals: same ? (p.deferrals ?? 0) + 1 : 1,
      lastDeferredAt: new Date().toISOString(),
      lastDeferReason: key,
    };
    await this.glossaryRepository.save(section);
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
    // Pending entries excluded: the proposals under judgement ARE the pending
    // entries, and including them made the adjudicator reject every proposal
    // for restating itself.
    const existing = this.glossaryService.summarizeGlossary(sections, {
      includePending: false,
    });
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
