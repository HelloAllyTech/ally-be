import { DriftJudgeRepository } from '../drift-judge.repository';
import { FeedbackGroundednessRepository } from '../feedback-groundedness.repository';
import { LanguageJudgeRepository } from '../language-judge.repository';
import { RecallQualityRepository } from '../recall-quality.repository';

/**
 * What the scheduled judges are allowed to pick, asserted on the SQL each
 * selector sends — the rules live in the WHERE clause, so that is where a
 * regression would be.
 *
 *   - Never a session that is still going. The selectors had no status or
 *     endedAt filter, so a tick mid-roleplay judged the transcript so far and
 *     `onlyUnjudged` then excluded the session for good.
 *   - Never a subject the attempt ledger has given up on, when the caller is
 *     scheduled — and always, when it is a manual backfill.
 *   - Language's drainer stays out of the live catch-up's window.
 */
describe('scheduled judge selection', () => {
  const capture = () => {
    const query = jest.fn().mockResolvedValue([]);
    return { query, dataSource: { query } as never };
  };
  const SETTLED =
    /s\.status = 'ENDED' AND COALESCE\(s\."endedAt", s\."updatedAt"\) < now\(\) - make_interval\(mins => 15\)/;

  describe('drift', () => {
    it('only picks sessions that ended at least fifteen minutes ago', async () => {
      const { query, dataSource } = capture();
      await new DriftJudgeRepository(dataSource).selectSessions({
        sinceDays: 1,
        onlyUnjudged: true,
      });

      expect(query.mock.calls[0][0]).toMatch(SETTLED);
    });

    it('applies the attempt ledger only when asked', async () => {
      const { query, dataSource } = capture();
      const repo = new DriftJudgeRepository(dataSource);
      await repo.selectSessions({ sinceDays: 1, onlyUnjudged: true });
      await repo.selectSessions({
        sinceDays: 1,
        onlyUnjudged: true,
        honourAttemptLedger: true,
      });

      expect(query.mock.calls[0][0]).not.toContain('judge_attempts');
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('FROM judge_attempts ja');
      expect(sql).toContain('ja."subjectId" = s.id');
      expect(params).toEqual(expect.arrayContaining(['drift', 3, 60]));
    });
  });

  describe('language', () => {
    it('only picks sessions that ended at least fifteen minutes ago', async () => {
      const { query, dataSource } = capture();
      await new LanguageJudgeRepository(dataSource).selectSessions({
        sinceDays: 150,
        onlyUnjudged: true,
      });

      expect(query.mock.calls[0][0]).toMatch(SETTLED);
    });

    it("leaves the catch-up's newest sessions alone when the drainer asks", async () => {
      const { query, dataSource } = capture();
      await new LanguageJudgeRepository(dataSource).selectSessions({
        sinceDays: 150,
        onlyUnjudged: true,
        unjudgedForVersion: {
          judgeModel: 'gemini-2.5-pro',
          judgePromptVersion: 'v2',
        },
        limit: 80,
        honourAttemptLedger: true,
        excludeCreatedWithinHours: 26,
      });

      const [sql, params] = query.mock.calls[0];
      // Older than the window, and still inside the drainer's own 150 days.
      expect(sql).toMatch(
        /s\."createdAt" < now\(\) - make_interval\(hours => \$(\d+)\)/,
      );
      const idx = Number(sql.match(/make_interval\(hours => \$(\d+)\)/)![1]);
      expect(params[idx - 1]).toBe(26);
      expect(sql).toMatch(/s\."createdAt" >= now\(\) - make_interval\(days/);
      expect(sql).toContain('FROM judge_attempts ja');
      expect(params).toEqual(expect.arrayContaining(['language', 3, 60]));
      // The LIMIT is still the last placeholder.
      expect(params[params.length - 1]).toBe(80);
    });

    it('reaches the newest sessions when the catch-up asks', async () => {
      const { query, dataSource } = capture();
      await new LanguageJudgeRepository(dataSource).selectSessions({
        sinceDays: 1,
        onlyUnjudged: true,
        honourAttemptLedger: true,
      });

      expect(query.mock.calls[0][0]).not.toContain('hours =>');
    });
  });

  describe('groundedness', () => {
    it('only picks settled sessions and honours the ledger when asked', async () => {
      const { query, dataSource } = capture();
      const repo = new FeedbackGroundednessRepository(dataSource);
      await repo.selectSessions({ sinceDays: 150 });
      await repo.selectSessions({ sinceDays: 150, honourAttemptLedger: true });

      expect(query.mock.calls[0][0]).toMatch(SETTLED);
      expect(query.mock.calls[0][0]).not.toContain('judge_attempts');
      expect(query.mock.calls[1][0]).toContain('FROM judge_attempts ja');
      expect(query.mock.calls[1][1]).toEqual(
        expect.arrayContaining(['groundedness', 3, 60]),
      );
    });
  });

  describe('recall quality', () => {
    it("only picks turns from sessions that are over, since a live turn's reply may not exist yet", async () => {
      const { query, dataSource } = capture();
      await new RecallQualityRepository(dataSource).selectTurns({
        sinceDays: 7,
      });

      const [sql] = query.mock.calls[0];
      expect(sql).toContain(
        'JOIN scenario_sessions s ON s.id = r."scenarioSessionId"',
      );
      expect(sql).toMatch(SETTLED);
    });

    it('keys the ledger by the TURN, not the session', async () => {
      const { query, dataSource } = capture();
      await new RecallQualityRepository(dataSource).selectTurns({
        sinceDays: 7,
        honourAttemptLedger: true,
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('ja."subjectId" = r.id');
      expect(params).toEqual(expect.arrayContaining(['recall-quality']));
    });
  });
});
