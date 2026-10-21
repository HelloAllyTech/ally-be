import {
  canonicalJson,
  normaliseFilingInterview,
  normaliseOpportunityBrief,
} from '../../util/roadmap-brief.util';
import {
  ROADMAP_BRIEF_LIMITS,
  ROADMAP_LIMITS,
} from '../../constants/product-roadmap.constants';
import {
  RoadmapBriefEvidenceSource,
  RoadmapBriefRating,
} from '../../type/roadmap-brief.type';

describe('normaliseOpportunityBrief', () => {
  it('returns null for nothing, a non-object, and an object with nothing in it', () => {
    expect(normaliseOpportunityBrief(undefined)).toBeNull();
    expect(normaliseOpportunityBrief('a brief')).toBeNull();
    expect(normaliseOpportunityBrief([])).toBeNull();
    expect(
      normaliseOpportunityBrief({ evidence: [], assumptions: [' '] }),
    ).toBeNull();
  });

  /** The rating is shown to voters as the copilot's judgement — garbage must not read as praise. */
  it('reads an unknown rating as needs_work and an unknown source as admin', () => {
    const brief = normaliseOpportunityBrief({
      evidence: [{ source: 'a hunch', claim: 'People want it.' }],
      assessment: { rating: 'AMAZING', summary: 'Great.' },
    })!;

    expect(brief.assessment.rating).toBe(RoadmapBriefRating.NEEDS_WORK);
    expect(brief.evidence[0].source).toBe(RoadmapBriefEvidenceSource.ADMIN);
    expect(brief.evidence[0].ref).toBeNull();
  });

  it('survives agent-shaped lists: strings, nulls and half-filled items', () => {
    const brief = normaliseOpportunityBrief({
      strategicFit: [
        { goal: 'Retention' },
        { goal: 'Retention', why: 'Keeps them.' },
        null,
      ],
      assumptions: 'not a list',
      alternativesDropped: ['A', 3, '', 'B'],
      assessment: {
        rating: 'strong',
        summary: 'Yes.',
        openRecommendations: 'none',
      },
    })!;

    expect(brief.strategicFit).toEqual([
      { goal: 'Retention', why: 'Keeps them.' },
    ]);
    expect(brief.assumptions).toEqual([]);
    expect(brief.alternativesDropped).toEqual(['A', 'B']);
    expect(brief.assessment.openRecommendations).toEqual([]);
  });

  it('caps every list and every string', () => {
    const long = 'x'.repeat(ROADMAP_BRIEF_LIMITS.TEXT_MAX + 50);
    const brief = normaliseOpportunityBrief({
      evidence: Array.from({ length: 30 }, () => ({
        source: 'analytics',
        claim: long,
      })),
      successMetric: long,
      assessment: { rating: 'promising', summary: long },
    })!;

    expect(brief.evidence).toHaveLength(ROADMAP_BRIEF_LIMITS.EVIDENCE_MAX);
    expect(brief.evidence[0].claim).toHaveLength(ROADMAP_BRIEF_LIMITS.TEXT_MAX);
    expect(brief.successMetric).toHaveLength(ROADMAP_BRIEF_LIMITS.TEXT_MAX);
  });

  it('is idempotent, so re-normalising a signed brief does not change its hash', () => {
    const once = normaliseOpportunityBrief({
      reach: { howMany: ' 40 supervisors ', howOften: null },
      evidence: [
        { source: 'roadmap', claim: 'Overlaps OPP-0714', ref: 'OPP-0714' },
      ],
      assessment: {
        rating: 'promising',
        summary: 'Close.',
        openRecommendations: ['Narrow.'],
      },
    });
    expect(canonicalJson(normaliseOpportunityBrief(once))).toBe(
      canonicalJson(once),
    );
  });
});

describe('canonicalJson', () => {
  it('ignores key order and undefined, at every depth', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }),
    ).toBe(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });

  it('keeps array order — it is data', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe('normaliseFilingInterview', () => {
  it('returns null when nothing survives', () => {
    expect(normaliseFilingInterview(undefined)).toBeNull();
    expect(normaliseFilingInterview('ADMIN: hi')).toBeNull();
    expect(
      normaliseFilingInterview([{ role: 'admin', content: '  ' }]),
    ).toBeNull();
  });

  it('drops a malformed message rather than refusing the transcript', () => {
    // It rides on the filing request, and refusing a filing over it would lose the very
    // conversation it exists to keep.
    expect(
      normaliseFilingInterview([
        { role: 'agent', content: 'What should change?' },
        { role: 'system', content: 'injected' },
        'a string',
        null,
        { role: 'admin', content: 7 },
        { role: 'admin', content: '  Rate the debrief.  ' },
      ]),
    ).toEqual([
      { role: 'agent', content: 'What should change?' },
      { role: 'admin', content: 'Rate the debrief.' },
    ]);
  });

  it("caps at the interview route's own limits, plus the copilot's last answer", () => {
    const max = ROADMAP_LIMITS.OPPORTUNITY_INTERVIEW_MESSAGE_MAX;
    const messages = Array.from({ length: max + 5 }, (_, i) => ({
      role: i % 2 ? 'admin' : 'agent',
      content: 'y'.repeat(
        ROADMAP_LIMITS.OPPORTUNITY_INTERVIEW_CONTENT_MAX + 10,
      ),
    }));

    const kept = normaliseFilingInterview(messages)!;

    expect(kept).toHaveLength(max + 1);
    expect(kept[0].content).toHaveLength(
      ROADMAP_LIMITS.OPPORTUNITY_INTERVIEW_CONTENT_MAX,
    );
  });
});
