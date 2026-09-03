import { BadRequestException } from '@nestjs/common';
import { GlossaryEntryStatus } from '../../entity/language-glossary-section.entity';
import {
  deferBackoffHours,
  deferReasonKey,
  GlossaryAdjudicationService,
} from '../glossary-adjudication.service';

const section = (over: any = {}) => ({
  sectionCode: 'core_style',
  profileId: null,
  injectionMode: 'always',
  status: 'published',
  content: '- existing line',
  entries: [],
  ...over,
});

const proposal = (id: string, markdown: string): any => ({
  id,
  markdown,
  status: GlossaryEntryStatus.PROPOSED,
  provenance: { source: 'consolidation', annotationIds: ['a1', 'a2'] },
});

describe('GlossaryAdjudicationService', () => {
  let service: GlossaryAdjudicationService;
  let glossaryService: any;
  let glossaryRepository: any;
  let getCompletion: jest.Mock;

  beforeEach(() => {
    getCompletion = jest.fn();
    glossaryRepository = {
      findAllForLanguage: jest.fn().mockResolvedValue([]),
      // The reject-vote recorder reads and writes the section.
      findSection: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (v: any) => v),
    };
    glossaryService = {
      assertLanguageExists: jest
        .fn()
        .mockResolvedValue({ id: 6, value: 'ta-IN', label: 'Tamil (India)' }),
      summarizeGlossary: jest
        .fn()
        .mockReturnValue('### core_style\n- existing line'),
      resolvePromptByCode: jest.fn().mockResolvedValue({
        systemPrompt: 'Adjudicate {{proposals}} for {{languageName}}',
        engine: {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          temperature: 0.2,
          maxTokens: 4096,
        },
      }),
      acceptProposal: jest.fn().mockResolvedValue({}),
      rejectProposal: jest.fn().mockResolvedValue({}),
      retierGlossary: jest
        .fn()
        .mockResolvedValue({ views: [{ promoted: [], demoted: [] }] }),
    };
    service = new GlossaryAdjudicationService(
      glossaryService,
      glossaryRepository,
      {
        getProvider: jest.fn().mockReturnValue({ getCompletion }),
      } as any,
    );
  });

  it('returns zeros and calls nothing when the queue is empty', async () => {
    const out = await service.adjudicateLanguage(6);
    expect(out).toEqual({
      considered: 0,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      proposals: [],
    });
    expect(getCompletion).not.toHaveBeenCalled();
  });

  // Form is annotated, not vetoed: a deterministic pre-veto rejected all six
  // real queued proposals in a production dry run, every one legitimate.
  it('sends the form classification to the adjudicator instead of vetoing', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [
          proposal(
            'e1',
            '- Use contracted spoken connectives, apply everywhere:\n  e.g. ஆமா (not ஆமாம்)',
          ),
        ],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        { index: 1, verdict: 'reject', reason: 'buried pair, 4% shape' },
      ]),
    );
    const out = await service.adjudicateLanguage(6);
    expect(getCompletion).toHaveBeenCalled();
    const messages = getCompletion.mock.calls[0][0];
    expect(messages[0].content).toContain('form=pair_only_in_example');
    // The model ruled reject; the gate holds it for a second pass, which is
    // covered by its own tests. What matters here is that form reached the
    // model at all rather than short-circuiting it.
    expect(out.considered).toBe(1);
    expect(out.proposals[0].reason).toContain('reject votes');
  });

  // The 2026-09-02 preview rejected ALL 9 queued proposals for "restating a
  // rule already present", quoting each proposal's own text back as the rule
  // it restated — because the glossary summary lists pending entries, and the
  // proposals under judgement ARE the pending entries.
  it('never shows the adjudicator the proposals as existing glossary', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );
    await service.adjudicateLanguage(6);
    expect(glossaryService.summarizeGlossary).toHaveBeenCalledWith(
      expect.anything(),
      { includePending: false },
    );
  });

  it('annotates a canonical rule as canonical', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );
    await service.adjudicateLanguage(6);
    expect(getCompletion.mock.calls[0][0][0].content).toContain(
      'form=canonical',
    );
  });

  // Rewriting keeps good substance that arrived in a shape the agent ignores.
  it('applies a canonical rewrite before accepting, preserving the entry id', async () => {
    const entry = proposal(
      'e1',
      '- Contract connectives, apply everywhere:\n  e.g. ஆமா (not ஆமாம்)',
    );
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        {
          index: 1,
          verdict: 'accept',
          reason: 'good substance, bad shape',
          rewrite: '- yes: say `ஆமா` (avoid: `ஆமாம்`)',
        },
      ]),
    );
    const out = await service.adjudicateLanguage(6);
    expect(entry.markdown).toBe('- yes: say `ஆமா` (avoid: `ஆமாம்`)');
    expect(entry.id).toBe('e1');
    expect(glossaryRepository.save).toHaveBeenCalledWith(sec);
    expect(out.accepted).toBe(1);
    expect(out.proposals[0].reason).toContain('rewritten to canonical form');
  });

  it('ignores a rewrite offered alongside a reject', async () => {
    const entry = proposal('e1', '- do not break character');
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        {
          index: 1,
          verdict: 'reject',
          reason: 'actor behaviour',
          rewrite: '- nope',
        },
      ]),
    );
    await service.adjudicateLanguage(6);
    // The rewrite must not be applied. A save DOES happen — the first-pass
    // reject records its vote — so assert on the text, not the write.
    expect(entry.markdown).toBe('- do not break character');
  });

  it('applies the adjudicator verdicts to accept and reject', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [
          proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)'),
          proposal('e2', '- do not break character during the roleplay'),
        ],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        { index: 1, verdict: 'accept', reason: 'colloquial substitution' },
        {
          index: 2,
          verdict: 'reject',
          reason: 'actor behaviour, not language',
        },
      ]),
    );
    const out = await service.adjudicateLanguage(6);
    // The accept lands immediately (revertible); the reject is held for a
    // second opinion (permanent), so it reports as deferred on pass one.
    expect(out).toMatchObject({
      considered: 2,
      accepted: 1,
      rejected: 0,
      deferred: 1,
    });
    expect(glossaryService.acceptProposal).toHaveBeenCalledWith(
      6,
      'core_style',
      'e1',
      'adjudicator',
      null,
    );
    expect(glossaryService.rejectProposal).not.toHaveBeenCalled();
  });

  // The gate exists because the same Tamil proposal was accepted at 15:00 and
  // rejected at 16:00 on identical input — a coin-flip deciding a permanent
  // outcome.
  it('holds a first-pass reject and records the vote', async () => {
    const entry = proposal('e1', '- do not break character');
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        { index: 1, verdict: 'reject', reason: '1. NOT A LANGUAGE RULE' },
      ]),
    );

    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ rejected: 0, deferred: 1 });
    expect(glossaryService.rejectProposal).not.toHaveBeenCalled();
    expect(entry.adjudication).toMatchObject({ rejectVotes: 1 });
    expect(entry.adjudication?.lastRejectReason).toContain(
      'NOT A LANGUAGE RULE',
    );
    expect(out.proposals[0].reason).toContain('1/2 reject votes');
  });

  it('applies the reject once a second consecutive pass agrees', async () => {
    const entry = {
      ...proposal('e1', '- do not break character'),
      adjudication: { rejectVotes: 1, lastRejectReason: 'prior pass' },
    };
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([
        { index: 1, verdict: 'reject', reason: '1. NOT A LANGUAGE RULE' },
      ]),
    );

    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ rejected: 1, deferred: 0 });
    expect(glossaryService.rejectProposal).toHaveBeenCalledWith(
      6,
      'core_style',
      'e1',
      'adjudicator',
      null,
    );
    expect(out.proposals[0].reason).toContain(
      'confirmed on 2 consecutive passes',
    );
  });

  // Votes must be CONSECUTIVE: an accept in between resets the streak, so a
  // proposal cannot be destroyed by two rejects separated by an accept.
  it('an accept clears a prior reject vote', async () => {
    const entry = {
      ...proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)'),
      adjudication: { rejectVotes: 1, lastRejectReason: 'prior pass' },
    };
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );

    const out = await service.adjudicateLanguage(6);
    expect(out.accepted).toBe(1);
    // The streak is zeroed rather than the object removed: deferral history
    // lives alongside it and must survive a reject-streak reset.
    expect(entry.adjudication).toEqual({ rejectVotes: 0 });
  });

  it('does not write a vote when preview mode is previewing', async () => {
    const entry = proposal('e1', '- do not break character');
    const sec = section({ entries: [entry] });
    glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
    glossaryRepository.findSection = jest.fn().mockResolvedValue(sec);
    glossaryRepository.save = jest.fn().mockResolvedValue(sec);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'reject', reason: 'persona' }]),
    );

    const out = await service.adjudicateLanguage(6, { apply: false });
    expect(out.rejected).toBe(1); // preview reports the raw verdict
    expect(glossaryRepository.save).not.toHaveBeenCalled();
    expect(entry.adjudication).toBeUndefined();
  });

  // Deferring on the cap alone was a dead end: a good rule sat in the queue
  // forever while the mechanism to reallocate the budget went unused.
  it('re-tiers to make room when the cap blocks an accept, then succeeds', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'good' }]),
    );
    glossaryService.acceptProposal
      .mockRejectedValueOnce(
        new BadRequestException(
          'Tier 0 glossary would be 2100 tokens, over the 2000-token cap.',
        ),
      )
      .mockResolvedValueOnce({});
    glossaryService.retierGlossary.mockResolvedValue({
      views: [{ promoted: [], demoted: ['grammar'] }],
    });

    const out = await service.adjudicateLanguage(6);
    expect(glossaryService.retierGlossary).toHaveBeenCalledWith(6, {
      apply: true,
    });
    expect(glossaryService.acceptProposal).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ accepted: 1, deferred: 0 });
  });

  it('does not re-tier for a non-cap accept failure', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'good' }]),
    );
    glossaryService.acceptProposal.mockRejectedValue(new Error('db down'));
    const out = await service.adjudicateLanguage(6);
    expect(glossaryService.retierGlossary).not.toHaveBeenCalled();
    expect(out).toMatchObject({ deferred: 1 });
  });

  // When the allocation is already optimal the cap still wins, and what
  // remains (raise the cap, trim content) is a decision, not a retry.
  it('defers when the cap still refuses after re-tiering', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'good' }]),
    );
    glossaryService.acceptProposal.mockRejectedValue(
      new BadRequestException(
        'Tier 0 glossary would be 2100 tokens, over the 2000-token cap.',
      ),
    );
    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ accepted: 0, deferred: 1 });
    expect(out.proposals[0].reason).toContain('over the 2000-token cap');
    // Two attempts: the first hits the cap, then one re-tier, then one retry.
    // It never loops — a cap that survives re-tiering is a decision to make.
    expect(glossaryService.acceptProposal).toHaveBeenCalledTimes(2);
    expect(glossaryService.retierGlossary).toHaveBeenCalledTimes(1);
  });

  // Silence must never read as approval.
  it('defers a proposal the adjudicator did not rule on', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [
          proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)'),
          proposal('e2', '- five: say `அஞ்சு` (avoid: `ஐந்து`)'),
        ],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );
    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ accepted: 1, deferred: 1 });
    expect(glossaryService.acceptProposal).toHaveBeenCalledTimes(1);
  });

  it('defers the batch when the adjudicator output is unparseable', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue('here are my thoughts: ...');
    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ accepted: 0, rejected: 0, deferred: 1 });
    expect(glossaryService.acceptProposal).not.toHaveBeenCalled();
  });

  it('defers, never auto-accepts, when the model call throws', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockRejectedValue(new Error('provider down'));
    const out = await service.adjudicateLanguage(6);
    expect(out).toMatchObject({ deferred: 1 });
    expect(glossaryService.acceptProposal).not.toHaveBeenCalled();
  });

  it('previews without touching anything when apply is false', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );
    const out = await service.adjudicateLanguage(6, { apply: false });
    expect(out.accepted).toBe(1);
    expect(glossaryService.acceptProposal).not.toHaveBeenCalled();
    expect(glossaryService.rejectProposal).not.toHaveBeenCalled();
  });

  it('carries the overlay profileId through to accept', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        profileId: 'p1',
        entries: [proposal('e1', '- yes: say `ஆமா` (avoid: `ஆமாம்`)')],
      }),
    ]);
    getCompletion.mockResolvedValue(
      JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
    );
    await service.adjudicateLanguage(6);
    expect(glossaryService.acceptProposal).toHaveBeenCalledWith(
      6,
      'core_style',
      'e1',
      'adjudicator',
      'p1',
    );
  });

  it('ignores entries that are not awaiting review', async () => {
    glossaryRepository.findAllForLanguage.mockResolvedValue([
      section({
        entries: [
          { ...proposal('e1', '- a'), status: GlossaryEntryStatus.ACCEPTED },
          { ...proposal('e2', '- b'), status: GlossaryEntryStatus.REJECTED },
        ],
      }),
    ]);
    const out = await service.adjudicateLanguage(6);
    expect(out.considered).toBe(0);
  });

  // A deferral leaves the entry PROPOSED, so without a backoff the hourly pass
  // re-sends an unchangeable verdict to gemini-2.5-pro forever.
  describe('defer backoff', () => {
    it('doubles the wait per consecutive deferral and caps at a week', () => {
      expect(deferBackoffHours(1)).toBe(1);
      expect(deferBackoffHours(2)).toBe(2);
      expect(deferBackoffHours(3)).toBe(4);
      expect(deferBackoffHours(4)).toBe(8);
      // 2**19 would be 524288h; the ceiling is the weekly cadence.
      expect(deferBackoffHours(20)).toBe(168);
      // Defensive: a corrupt/zero count must not produce a negative wait.
      expect(deferBackoffHours(0)).toBe(1);
    });

    const deferred = (over: any) => {
      const entry = proposal('e1', '- some rule');
      entry.adjudication = { rejectVotes: 0, ...over };
      return entry;
    };

    it('withholds a proposal still inside its wait, and calls no model', async () => {
      const entry = deferred({
        deferrals: 3, // 4h wait
        lastDeferredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        lastDeferReason: 'would breach the tier 0 cap (#/#)',
      });
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({ entries: [entry] }),
      ]);

      const out = await service.adjudicateLanguage(6, {
        respectBackoff: true,
      });

      expect(out.considered).toBe(0);
      expect(getCompletion).not.toHaveBeenCalled();
    });

    it('reconsiders once the wait has elapsed', async () => {
      const entry = deferred({
        deferrals: 3, // 4h wait
        lastDeferredAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        lastDeferReason: 'would breach the tier 0 cap (#/#)',
      });
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({ entries: [entry] }),
      ]);
      getCompletion.mockResolvedValue(
        JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
      );

      const out = await service.adjudicateLanguage(6, {
        respectBackoff: true,
      });

      expect(out.considered).toBe(1);
      expect(getCompletion).toHaveBeenCalled();
    });

    // A human asking explicitly should not be told to come back in a week.
    it('ignores the backoff when not asked to respect it', async () => {
      const entry = deferred({
        deferrals: 8,
        lastDeferredAt: new Date().toISOString(),
        lastDeferReason: 'would breach the tier 0 cap (#/#)',
      });
      glossaryRepository.findAllForLanguage.mockResolvedValue([
        section({ entries: [entry] }),
      ]);
      getCompletion.mockResolvedValue(
        JSON.stringify([{ index: 1, verdict: 'accept', reason: 'ok' }]),
      );

      const out = await service.adjudicateLanguage(6);

      expect(out.considered).toBe(1);
    });

    // Cap-breach reasons carry live token counts, so the identity that drives
    // the streak has to ignore digits or the backoff would never accumulate.
    it('treats reasons differing only in numbers as the same reason', () => {
      expect(deferReasonKey('would breach the cap (2065/2000)')).toBe(
        deferReasonKey('would breach the cap (2071/2000)'),
      );
      expect(deferReasonKey('cap breach')).not.toBe(
        deferReasonKey('adjudicator returned no verdict'),
      );
      expect(deferReasonKey(null)).toBe('');
    });

    it('escalates the streak for a repeated reason', async () => {
      const entry = deferred({
        deferrals: 2,
        lastDeferredAt: new Date(
          Date.now() - 99 * 60 * 60 * 1000,
        ).toISOString(),
        lastDeferReason: 'adjudicator returned no verdict for this proposal',
      });
      const sec = section({ entries: [entry] });
      glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
      glossaryRepository.findSection.mockResolvedValue(sec);
      // The model omits it -> deferred with the same reason as before.
      getCompletion.mockResolvedValue(JSON.stringify([]));

      await service.adjudicateLanguage(6, { respectBackoff: true });

      expect(entry.adjudication.deferrals).toBe(3);
    });

    it('resets the streak when the reason genuinely changes', async () => {
      const entry = deferred({
        deferrals: 6,
        lastDeferredAt: new Date(
          Date.now() - 999 * 60 * 60 * 1000,
        ).toISOString(),
        lastDeferReason: 'something else entirely',
      });
      const sec = section({ entries: [entry] });
      glossaryRepository.findAllForLanguage.mockResolvedValue([sec]);
      glossaryRepository.findSection.mockResolvedValue(sec);
      getCompletion.mockResolvedValue(JSON.stringify([]));

      await service.adjudicateLanguage(6, { respectBackoff: true });

      expect(entry.adjudication.deferrals).toBe(1);
      // And a deferral is not agreement to reject.
      expect(entry.adjudication.rejectVotes).toBe(0);
    });
  });
});
