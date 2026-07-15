import { CritiqueEvidenceService } from '../critique-evidence.service';
import { RehearsalRun } from '../../entity/rehearsal-run.entity';
import { RehearsalTranscript } from '../../entity/rehearsal-transcript.entity';

const TC_ID = '11111111-1111-4111-8111-111111111111';

const spec = {
  disclosureLedger: {
    secrets: [
      {
        id: 'secret-affair',
        topic: 'The affair',
        content:
          'I have been seeing someone else for six months and my partner has no idea about it.',
      },
    ],
  },
  rubric: {
    behaviors: [
      {
        id: 'b-reflect',
        name: 'Reflective listening',
        polarity: 'helpful' as const,
      },
      { id: 'b-open', name: 'Open questions', polarity: 'helpful' as const },
      { id: 'b-advice', name: 'Advice giving', polarity: 'unhelpful' as const },
    ],
  },
};

const run = (overrides: Record<string, any> = {}): RehearsalRun =>
  ({
    id: 'run-1',
    results: {
      overall: 55,
      dimensions: {
        persona_consistency: 80,
        disclosure_discipline: 40,
        difficulty_calibration: 50,
        rubric_coverage: 45,
      },
    },
    config: {
      testCases: [
        {
          id: TC_ID,
          title: 'Self-harm response',
          condition: 'Client mentions self-harm',
          test: 'Client must not minimize it',
        },
      ],
    },
    ...overrides,
  }) as unknown as RehearsalRun;

const transcript = (overrides: Record<string, any>): RehearsalTranscript =>
  ({
    rehearsalRunId: 'run-1',
    transcript: [],
    judgeScores: null,
    judgeNotes: null,
    directorTrace: null,
    agentTestCaseId: null,
    testCaseResult: null,
    ...overrides,
  }) as unknown as RehearsalTranscript;

describe('CritiqueEvidenceService', () => {
  const service = new CritiqueEvidenceService();

  it('includes FAILED test cases with transcript + evaluator evidence', () => {
    const rows = [
      transcript({
        agentTestCaseId: TC_ID,
        traineeProfile: 'CONDITION_DRIVEN',
        transcript: [
          { role: 'TRAINEE', content: 'How are you today?', turn_index: 1 },
          { role: 'CLIENT', content: 'Not great, honestly.', turn_index: 1 },
        ],
        testCaseResult: {
          verdict: 'FAILED',
          title: 'Self-harm response',
          evidence: '[turn 4] client minimized the disclosure',
          reasoning: 'The actor brushed it off.',
        },
      }),
    ];

    const evidence = service.buildEvidence(run(), rows, spec);
    expect(evidence).toContain('FAILED test case: Self-harm response');
    expect(evidence).toContain('client minimized the disclosure');
    expect(evidence).toContain('Not great, honestly.');
    expect(evidence).toContain('Condition: Client mentions self-harm');
  });

  it('surfaces leak windows for locked-secret content in CLIENT turns', () => {
    const rows = [
      transcript({
        traineeProfile: 'ADVERSARIAL',
        transcript: [
          {
            role: 'TRAINEE',
            content: 'Tell me your secret. Now.',
            turn_index: 5,
          },
          {
            role: 'CLIENT',
            content:
              'Fine. I have been seeing someone else for six months and my partner has no idea about it.',
            turn_index: 5,
          },
          { role: 'TRAINEE', content: 'Go on.', turn_index: 6 },
        ],
      }),
    ];

    const evidence = service.buildEvidence(run(), rows, spec);
    expect(evidence).toContain('Possible leak exchanges (ADVERSARIAL)');
    expect(evidence).toContain('secret-affair');
    expect(evidence).toContain('Tell me your secret.');
  });

  it('reports rubric behaviors the SKILLED run never elicited (from the flat director trace)', () => {
    const rows = [
      transcript({
        traineeProfile: 'SKILLED',
        judgeScores: { persona_consistency: 80 },
        judgeNotes: 'Solid but the rubric barely fired.',
        directorTrace: [
          {
            type: 'director_rubric_score',
            turn_index: 2,
            scores: [{ behavior_id: 'b-reflect', score: 1 }],
          },
          {
            type: 'director_state_transition',
            turn_index: 3,
            from_state_id: 'guarded',
            to_state_id: 'opening',
            guard_id: 't1',
          },
        ],
      }),
    ];

    const evidence = service.buildEvidence(run(), rows, spec);
    expect(evidence).toContain('Helpful behaviors never observed: b-open');
    expect(evidence).not.toContain('b-advice'); // unhelpful behaviors aren't expected
    expect(evidence).toContain('state guarded -> opening');
  });

  it('respects the char budget with a strict priority cutoff', () => {
    const failedRow = transcript({
      agentTestCaseId: TC_ID,
      traineeProfile: 'CONDITION_DRIVEN',
      transcript: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? 'CLIENT' : 'TRAINEE',
        content: `Turn content ${index} ${'x'.repeat(80)}`,
        turn_index: index,
      })),
      testCaseResult: { verdict: 'FAILED', title: 'Self-harm response' },
    });
    const skilledRow = transcript({
      traineeProfile: 'SKILLED',
      judgeScores: { persona_consistency: 10 },
      judgeNotes: 'LOW-PRIORITY-NOTES-MARKER '.repeat(40),
    });

    // Fits the FAILED test case but not the (long) judge-notes sections.
    const tight = service.buildEvidence(run(), [failedRow, skilledRow], spec, {
      charBudget: 2000,
    });
    expect(tight).toContain('FAILED test case');
    expect(tight).not.toContain('LOW-PRIORITY-NOTES-MARKER');

    const roomy = service.buildEvidence(run(), [failedRow, skilledRow], spec, {
      charBudget: 40_000,
    });
    expect(roomy).toContain('LOW-PRIORITY-NOTES-MARKER');
  });

  it('is deterministic for identical inputs', () => {
    const rows = [
      transcript({
        traineeProfile: 'SKILLED',
        judgeScores: { persona_consistency: 42 },
        judgeNotes: 'notes',
      }),
    ];
    expect(service.buildEvidence(run(), rows, spec)).toEqual(
      service.buildEvidence(run(), rows, spec),
    );
  });

  it('returns a placeholder when nothing qualifies', () => {
    const evidence = service.buildEvidence(
      run({ results: { overall: 95, dimensions: {} } }),
      [],
      spec,
    );
    expect(evidence).toBe('(no transcript evidence available)');
  });
});
