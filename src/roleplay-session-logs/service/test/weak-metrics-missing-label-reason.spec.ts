import { RoleplaySessionLogsService } from '../roleplay-session-logs.service';

/**
 * A label count of zero has two causes that must not be reported as one.
 *
 * A session never judged and a session judged under the older rubric both reach
 * the mapper with zero labelled turns. The card used to say "re-judge to
 * populate" for both, which on an unjudged session contradicted the summary
 * line on the same screen and sent readers hunting for a broken pipeline —
 * there is nothing to re-judge, the catch-up scheduler simply has not run yet.
 */
describe('RoleplaySessionLogsService.buildWeakMetrics — missing-label reason', () => {
  // The mapper is pure over its argument; the injected collaborators are never
  // touched on this path, so they are stubbed rather than mocked.
  const service = new RoleplaySessionLogsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const build = (raw: Record<string, unknown>) =>
    (
      service as never as {
        buildWeakMetrics: (r: unknown) => {
          metrics: { id: string; detail: string | null; state: string }[];
        };
      }
    ).buildWeakMetrics({
      judgedTurns: 0,
      languageTurnsJudged: 0,
      progressionLabelledTurns: 0,
      clienthoodLabelledTurns: 0,
      longestRepeatRun: 0,
      staleAiPairs: 0,
      comparableAiPairs: 0,
      ...raw,
    });

  const detailOf = (raw: Record<string, unknown>, id: string) =>
    build(raw).metrics.find((m) => m.id === id)?.detail;

  it('tells an unjudged session to wait, not to re-judge', () => {
    expect(detailOf({ judgedTurns: 0 }, 'inappropriate_stasis')).toBe(
      'Not judged yet — judge lines fill in within ~30 minutes',
    );
    expect(detailOf({ judgedTurns: 0 }, 'role_inversion')).toBe(
      'Not judged yet — judge lines fill in within ~30 minutes',
    );
  });

  it('still asks for a re-judge when the session WAS judged, under the old rubric', () => {
    // judgedTurns > 0 with zero labelled turns is the genuine stale-rubric
    // case — the judge ran, the rubric it ran under had no such label.
    expect(
      detailOf(
        { judgedTurns: 12, progressionLabelledTurns: 0 },
        'inappropriate_stasis',
      ),
    ).toBe('Session judged before the v2 rubric — re-judge to populate');
  });

  it('says nothing about rubrics once the labels are actually there', () => {
    expect(
      detailOf(
        { judgedTurns: 12, progressionLabelledTurns: 8 },
        'inappropriate_stasis',
      ),
    ).toBe(
      'A client rightly refusing to yield to a weak intervention is excluded',
    );
    expect(
      detailOf(
        { judgedTurns: 12, clienthoodLabelledTurns: 8 },
        'role_inversion',
      ),
    ).toBeNull();
  });

  it('agrees with the state flag — a reason is only shown when unmeasured', () => {
    // The two must never disagree: a card cannot be "measured" and also carry a
    // reason for having no data.
    const unjudged = build({ judgedTurns: 0 }).metrics.find(
      (m) => m.id === 'inappropriate_stasis',
    );
    expect(unjudged?.state).toBe('none');

    const judged = build({
      judgedTurns: 12,
      progressionLabelledTurns: 8,
    }).metrics.find((m) => m.id === 'inappropriate_stasis');
    expect(judged?.state).toBe('measured');
  });
});
