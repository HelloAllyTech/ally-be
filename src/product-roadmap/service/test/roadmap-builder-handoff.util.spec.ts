import { BUILDER_HANDOFF_TRANSCRIPT_MAX } from '../../constants/product-roadmap.constants';
import {
  RoadmapBriefEvidenceSource,
  RoadmapBriefRating,
  RoadmapOpportunityBrief,
} from '../../type/roadmap-brief.type';
import {
  describeBuilderHandoff,
  renderBuilderHandoff,
} from '../../util/roadmap-builder-handoff.util';

const emptyBrief = (
  over: Partial<RoadmapOpportunityBrief> = {},
): RoadmapOpportunityBrief => ({
  strategicFit: [],
  reach: { howMany: null, howOften: null },
  evidence: [],
  successMetric: null,
  assumptions: [],
  alternativesDropped: [],
  assessment: {
    rating: RoadmapBriefRating.NEEDS_WORK,
    summary: '',
    openRecommendations: [],
  },
  ...over,
});

describe('renderBuilderHandoff', () => {
  it('renders every part of the brief a Builder interview would otherwise re-ask', () => {
    const text = renderBuilderHandoff({
      code: 'OPP-0042',
      description: 'Learners rate the debrief.',
      prd: 'Keep the session rating.',
      brief: emptyBrief({
        strategicFit: [{ goal: 'Engagement', why: 'Closes the loop.' }],
        reach: { howMany: 'Every learner', howOften: 'Each session' },
        evidence: [
          {
            source: RoadmapBriefEvidenceSource.CODEBASE,
            claim: 'A star rating exists already',
            ref: 'PostSimulationSummary.tsx',
          },
        ],
        successMetric: 'Share marked helpful',
        assumptions: ['Learners will react when asked'],
        alternativesDropped: ['A separate long survey'],
        assessment: {
          rating: RoadmapBriefRating.NEEDS_WORK,
          summary: 'Thin evidence.',
          openRecommendations: ['Size the audience'],
        },
      }),
    });

    expect(text).toContain('(OPP-0042)');
    expect(text).toContain('Learners rate the debrief.');
    expect(text).toContain(
      '## PRD notes on the opportunity\n\nKeep the session rating.',
    );
    expect(text).toContain(
      "**Copilot's assessment:** needs work — Thin evidence.",
    );
    expect(text).toContain('- Size the audience');
    expect(text).toContain('- Engagement: Closes the loop.');
    expect(text).toContain('how many: Every learner; how often: Each session');
    expect(text).toContain('**Success metric:** Share marked helpful');
    expect(text).toContain(
      '- [codebase] A star rating exists already (PostSimulationSummary.tsx)',
    );
    expect(text).toContain('- Learners will react when asked');
    expect(text).toContain('- A separate long survey');
  });

  it('omits empty sections rather than rendering blank ones', () => {
    // An empty "Evidence" heading reads as "looked, found nothing" — a different fact from
    // "nobody looked".
    const text = renderBuilderHandoff({
      description: 'Learners rate the debrief.',
      brief: emptyBrief(),
    });

    expect(text).not.toContain('PRD notes');
    expect(text).not.toContain('Evidence');
    expect(text).not.toContain('Reach');
    expect(text).not.toContain('Success metric');
    expect(text).not.toContain('filing interview');
    expect(text).not.toContain('(null)');
  });

  it('labels the copilot as COPILOT, never as the reader', () => {
    // Builder did not ask these questions. Labelled as its own turns, it would treat them as
    // its own and carry on from them as if it had.
    const text = renderBuilderHandoff({
      description: 'd',
      interviewTranscript: [
        { role: 'agent', content: 'What should change?' },
        { role: 'admin', content: 'Rate the debrief.' },
      ],
    });

    expect(text).toContain(
      'COPILOT: What should change?\n\nADMIN: Rate the debrief.',
    );
    expect(text).toContain('2 messages');
    expect(text).not.toContain('YOU:');
  });

  it('keeps the opening ask and the latest turns when the interview is too long', () => {
    const long = 'z'.repeat(3_000);
    const messages = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 ? 'admin' : 'agent') as 'admin' | 'agent',
      content: `#${i} ${long}`,
    }));

    const text = renderBuilderHandoff({
      description: 'd',
      interviewTranscript: messages,
    });

    const transcript = text.slice(text.indexOf('COPILOT: #0'));
    expect(transcript.length).toBeLessThanOrEqual(
      BUILDER_HANDOFF_TRANSCRIPT_MAX + 100,
    );
    // The opening exchange — the copilot's first question and the original ask.
    expect(text).toContain('COPILOT: #0 ');
    expect(text).toContain('ADMIN: #1 ');
    // The end, where the decisions land.
    expect(text).toContain('ADMIN: #59 ');
    expect(text).not.toContain('#2 ');
    expect(text).toMatch(/\[… \d+ messages omitted for length …\]/);
    expect(text).toMatch(/60 messages, \d+ of them omitted below/);
  });
});

describe('describeBuilderHandoff', () => {
  it('reports what came over beyond the description', () => {
    expect(describeBuilderHandoff({ description: 'd' })).toEqual({
      hasBrief: false,
      interviewMessages: 0,
    });
    expect(
      describeBuilderHandoff({
        description: 'd',
        brief: emptyBrief(),
        interviewTranscript: [{ role: 'admin', content: 'x' }],
      }),
    ).toEqual({ hasBrief: true, interviewMessages: 1 });
  });
});
