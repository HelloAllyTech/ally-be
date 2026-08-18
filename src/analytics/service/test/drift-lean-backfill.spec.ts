import { DriftJudgeService } from '../drift-judge.service';

/**
 * The lean backfill tops up rows that already exist. Two invariants keep that
 * safe, and neither is visible in a typecheck:
 *
 *   - live judging must never take this path, because a session judged for the
 *     first time through it would produce a row with no coherence, failure mode
 *     or attribution at all; and
 *   - a session with nothing to copy forward must be excluded from the run,
 *     not attempted and silently written as a partial row.
 */
describe('drift lean backfill', () => {
  const build = () => {
    const repo = {
      fetchRubric: jest.fn().mockResolvedValue('RUBRIC'),
      selectSessions: jest.fn().mockResolvedValue([]),
      buildTranscript: jest.fn(),
      upsertJudgments: jest.fn(),
      mergeLeanLabels: jest.fn(),
    };
    const redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    // Constructor order is (repo, config, redis) — a mis-ordered stub fails
    // deep inside saveJob rather than at construction, so it is worth pinning.
    const service = new DriftJudgeService(
      repo as never,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as never,
      redis as never,
    );
    return { service, repo };
  };

  const flush = () => new Promise((r) => setTimeout(r, 10));

  it('asks only for sessions that already carry the source judgment', async () => {
    const { service, repo } = build();

    await service.startBackfill(
      30,
      true,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
      3,
      { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' },
    );
    await flush();

    expect(repo.selectSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        // Must be topped up, not re-judged: has v1, lacks v2.
        judgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v1',
        },
        unjudgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v2',
        },
      }),
    );
  });

  it('leaves the full path untouched when no lean source is given', async () => {
    const { service, repo } = build();

    // This is the shape the 30-minute catch-up uses for live sessions.
    await service.startBackfill(1, true);
    await flush();

    const opts = repo.selectSessions.mock.calls[0][0];
    expect(opts.judgedForVersion).toBeNull();
  });
});
