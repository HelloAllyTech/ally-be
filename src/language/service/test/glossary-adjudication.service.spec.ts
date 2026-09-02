import { BadRequestException } from '@nestjs/common';
import { GlossaryEntryStatus } from '../../entity/language-glossary-section.entity';
import { GlossaryAdjudicationService } from '../glossary-adjudication.service';

const section = (over: any = {}) => ({
  sectionCode: 'core_style',
  profileId: null,
  injectionMode: 'always',
  status: 'published',
  content: '- existing line',
  entries: [],
  ...over,
});

const proposal = (id: string, markdown: string) => ({
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

  // The buried-pair shape measured 4% agent compliance; rejecting it needs no
  // model call, and spending one would re-judge measured evidence.
  it('rejects a non-binding rule form without any model call', async () => {
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
    const out = await service.adjudicateLanguage(6);
    expect(getCompletion).not.toHaveBeenCalled();
    expect(out.rejected).toBe(1);
    expect(out.proposals[0].reason).toContain('4% agent compliance');
    expect(glossaryService.rejectProposal).toHaveBeenCalled();
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
    expect(out).toMatchObject({
      considered: 2,
      accepted: 1,
      rejected: 1,
      deferred: 0,
    });
    expect(glossaryService.acceptProposal).toHaveBeenCalledWith(
      6,
      'core_style',
      'e1',
      'adjudicator',
      null,
    );
    expect(glossaryService.rejectProposal).toHaveBeenCalledWith(
      6,
      'core_style',
      'e2',
      'adjudicator',
      null,
    );
  });

  // The Tier 0 cap is authoritative — Tamil sat at 1996/2000 with good
  // proposals queued. Defer and report; never retry or force.
  it('defers rather than forces when the Tier 0 cap rejects the accept', async () => {
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
    expect(glossaryService.acceptProposal).toHaveBeenCalledTimes(1);
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
});
