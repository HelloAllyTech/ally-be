import { LanguageAnalyticsService } from '../language-analytics.service';

/**
 * Prompt attribution for the language judge.
 *
 * `rateByPromptVersion` reports a version NUMBER, so two different main-agent
 * prompts both sitting at version 3 are indistinguishable — which made the
 * question "does working memory change persona_break?" unanswerable from this
 * dashboard.
 */
describe('LanguageAnalyticsService — rateByMainPrompt', () => {
  const make = (totals: unknown[], weighted: unknown[]) => {
    const repo = {
      sessionTotalsBy: jest.fn().mockResolvedValue([]),
      weightedBy: jest.fn().mockResolvedValue([]),
      sessionTotalsByMainPrompt: jest.fn().mockResolvedValue(totals),
      weightedByMainPrompt: jest.fn().mockResolvedValue(weighted),
    };
    return {
      repo,
      svc: new LanguageAnalyticsService(repo as never),
    };
  };

  it('separates two prompts that share a version number', async () => {
    const { svc } = make(
      [
        {
          value: 'ally_ai_learn_system_main_agent_prompt_full',
          sessions: '10',
          turns: '100',
        },
        {
          value: 'ally_ai_learn_system_main_agent_prompt_working_memory_split',
          sessions: '10',
          turns: '200',
        },
      ],
      [
        {
          value: 'ally_ai_learn_system_main_agent_prompt_full',
          severity: 'major',
          count: '20',
        },
        {
          value: 'ally_ai_learn_system_main_agent_prompt_working_memory_split',
          severity: 'major',
          count: '20',
        },
      ],
    );

    const rows = await (
      svc as never as {
        byMainPrompt: (
          f: unknown,
        ) => Promise<
          Array<{ value: string; nTurns: number; weightedRatePer100: number }>
        >;
      }
    ).byMainPrompt({});

    const full = rows.find((r) => r.value.endsWith('_full'))!;
    const wm = rows.find((r) => r.value.endsWith('_split'))!;
    // Same error COUNT, double the turns — the rate must halve. A raw count
    // comparison would have called these equal.
    expect(full.weightedRatePer100).toBeGreaterThan(wm.weightedRatePer100);
    expect(full.nTurns).toBe(100);
    expect(wm.nTurns).toBe(200);
  });

  it('labels sessions with no recorded prompt as unknown rather than dropping them', async () => {
    // Pre-dating promptVersions in session metadata. Silently omitting them
    // would shrink the denominator and flatter whichever prompt is measured.
    const { svc } = make(
      [{ value: null, sessions: '5', turns: '50' }],
      [{ value: null, severity: 'minor', count: '5' }],
    );

    const rows = await (
      svc as never as {
        byMainPrompt: (
          f: unknown,
        ) => Promise<Array<{ value: string; nTurns: number }>>;
      }
    ).byMainPrompt({});

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('unknown');
    expect(rows[0].nTurns).toBe(50);
  });
});
