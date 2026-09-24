import { DataSource } from 'typeorm';
import { TrackProgressDashboardRepository } from '../track-progress-dashboard.repository';

describe('TrackProgressDashboardRepository.getRoleplayFeedback', () => {
  const ENROLLMENT_ID = 'enr-1';

  let query: jest.Mock;
  let repository: TrackProgressDashboardRepository;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    repository = new TrackProgressDashboardRepository({
      query,
    } as unknown as DataSource);
  });

  /**
   * One evaluated attempt whose two scores disagree, exactly as the reported
   * session did: the learner scored 60, and the actor-evaluation judge's
   * composite for the same transcript was 78. Keys are the query's own
   * aliases, which is what pg hands back.
   */
  const rawRow = () => ({
    trackItemId: 'item-1',
    trackItemTitle: 'Practice: an upset client',
    scenarioSessionId: 'sess-1',
    sessionScore: 60,
    compositeScore: 78,
    occurredAt: '2026-09-16T00:00:00.000Z',
    skillCoverage: [{ category: 'Listening Engagement', percentage: 80 }],
    evaluationMarkdown: '## What worked\nGood rapport building.',
  });

  it('reads the score off the session, not the actor-evaluation composite', async () => {
    await repository.getRoleplayFeedback(ENROLLMENT_ID);

    const [sql] = query.mock.calls[0];
    // `scenario_sessions.score` is the learner's roleplay score — the meter
    // they watched, the gate `meetsMinimumScore` applies, and the number
    // Roleplay Logs and Track Overview both show. Selecting the judge's
    // composite here is what made the same session read 60 in one view and
    // 78 in the other.
    expect(sql).toContain('s."score"');
    expect(sql).toContain('AS "sessionScore"');
    expect(sql).not.toContain('AS "compositeScore"');
  });

  it('returns the learner score for an attempt whose judge composite differs', async () => {
    query.mockResolvedValue([rawRow()]);

    const rows = await repository.getRoleplayFeedback(ENROLLMENT_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0].sessionScore).toBe(60);
  });

  it('keeps a negative roleplay score as-is rather than treating it as absent', async () => {
    // A roleplay score is a SUM over scenario_session_events.score and detected
    // events carry penalties, so the learner-facing meter runs -100..100 (see
    // meetsMinimumScore). A negative score is an ordinary outcome.
    query.mockResolvedValue([{ ...rawRow(), sessionScore: -20 }]);

    const rows = await repository.getRoleplayFeedback(ENROLLMENT_ID);

    expect(rows[0].sessionScore).toBe(-20);
  });

  it('surfaces an unscored session as null, never as 0', async () => {
    query.mockResolvedValue([{ ...rawRow(), sessionScore: null }]);

    const rows = await repository.getRoleplayFeedback(ENROLLMENT_ID);

    expect(rows[0].sessionScore).toBeNull();
  });
});
