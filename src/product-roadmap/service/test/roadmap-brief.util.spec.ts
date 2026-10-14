import {
  canonicalJson,
  normaliseOpportunityBrief,
} from '../../util/roadmap-brief.util';
import { ROADMAP_BRIEF_LIMITS } from '../../constants/product-roadmap.constants';
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
