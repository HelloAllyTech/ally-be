import { JudgeAttemptRepository } from '../judge-attempt.repository';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../../constants/judge-scheduling.constants';

describe('JudgeAttemptRepository', () => {
  const build = (query = jest.fn().mockResolvedValue([])) => ({
    repo: new JudgeAttemptRepository({ query } as never),
    query,
  });

  describe('recordFailure', () => {
    it('upserts one row per subject and counts attempts up', async () => {
      const { repo, query } = build();
      await repo.recordFailure(
        JudgeAttemptFamily.DRIFT,
        'sess-1',
        'tenant-1',
        JudgeAttemptOutcome.FAILED,
        Object.assign(new Error('Request failed'), {
          isAxiosError: true,
          response: { status: 502 },
        }),
      );

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/ON CONFLICT \("family", "subjectId"\)/);
      expect(sql).toContain('"attempts" = judge_attempts."attempts" + 1');
      expect(sql).toContain('"lastAttemptAt" = now()');
      expect(params).toEqual([
        'drift',
        'sess-1',
        'tenant-1',
        'failed',
        'http 502',
      ]);
    });

    it('stores a label for a caught error, never its message', async () => {
      const { repo, query } = build();
      await repo.recordFailure(
        JudgeAttemptFamily.LANGUAGE,
        'sess-1',
        'tenant-1',
        JudgeAttemptOutcome.FAILED,
        new Error('value "she said she wants to die" violates constraint'),
      );

      const [, params] = query.mock.calls[0];
      expect(params[4]).toBe('Error');
    });

    it("keeps the caller's own reason for an empty answer", async () => {
      const { repo, query } = build();
      await repo.recordFailure(
        JudgeAttemptFamily.GROUNDEDNESS,
        'sess-1',
        null,
        JudgeAttemptOutcome.EMPTY,
        'judge returned no claims',
      );

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([
        'groundedness',
        'sess-1',
        null,
        'empty',
        'judge returned no claims',
      ]);
    });

    it('never throws into the judge loop it is called from', async () => {
      const { repo } = build(jest.fn().mockRejectedValue(new Error('db down')));

      await expect(
        repo.recordFailure(
          JudgeAttemptFamily.RECALL_QUALITY,
          'sel-1',
          undefined,
          JudgeAttemptOutcome.FAILED,
          new Error('boom'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('deletes the subject row so a later failure starts from one', async () => {
      const { repo, query } = build();
      await repo.clear(JudgeAttemptFamily.LANGUAGE, 'sess-1');

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/DELETE FROM judge_attempts/);
      expect(params).toEqual(['language', 'sess-1']);
    });

    it('never throws', async () => {
      const { repo } = build(jest.fn().mockRejectedValue(new Error('db down')));

      await expect(
        repo.clear(JudgeAttemptFamily.DRIFT, 'sess-1'),
      ).resolves.toBeUndefined();
    });
  });
});
