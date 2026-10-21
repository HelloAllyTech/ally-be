import { NotFoundException } from '@nestjs/common';
import {
  CourseCopilotEventType,
  CourseCopilotJobStatus as JobStatus,
  CourseCopilotMessageRole,
} from '../../enum/course-copilot.enum';
import {
  CourseCopilotEventRepository,
  CourseCopilotJobRepository,
  CourseCopilotMessageRepository,
} from '../course-copilot.repository';

/**
 * The repositories are mostly conditional UPDATE … RETURNING statements, which
 * need Postgres to prove. What can be pinned without it is the part that has
 * bitten this codebase before: on Postgres `EntityManager.query()` returns a
 * `[rows, affectedCount]` tuple for a RETURNING UPDATE, not a bare rows array —
 * reading it as rows once made Builder report "session not found" for a
 * session that existed.
 */
describe('Course Copilot repositories', () => {
  let query: jest.Mock;
  let dataSource: { createEntityManager: jest.Mock; transaction: jest.Mock };
  let txManager: { query: jest.Mock; getRepository: jest.Mock };
  let entityRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    query = jest.fn();
    entityRepo = {
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => row),
    };
    txManager = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue(entityRepo),
    };
    dataSource = {
      createEntityManager: jest.fn().mockReturnValue({ query }),
      transaction: jest.fn(async (fn: (em: any) => any) => fn(txManager)),
    };
  });

  describe('CourseCopilotJobRepository', () => {
    let repo: CourseCopilotJobRepository;
    beforeEach(() => {
      repo = new CourseCopilotJobRepository(dataSource as any);
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue({ id: 'job-1', status: JobStatus.RUNNING } as any);
    });

    describe('claim', () => {
      it("returns the job when the UPDATE matched, reading Postgres's [rows, count] tuple", async () => {
        query.mockResolvedValue([[{ id: 'job-1' }], 1]);
        await expect(repo.claim('job-1')).resolves.toMatchObject({
          id: 'job-1',
        });
        expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'job-1' } });
      });

      it('also accepts a bare rows array', async () => {
        query.mockResolvedValue([{ id: 'job-1' }]);
        await expect(repo.claim('job-1')).resolves.toMatchObject({
          id: 'job-1',
        });
      });

      it.each([
        ['an empty tuple', [[], 0]],
        ['an empty array', []],
      ])(
        'returns null when another runner got there first (%s)',
        async (_name, result) => {
          query.mockResolvedValue(result);
          await expect(repo.claim('job-1')).resolves.toBeNull();
          expect(repo.findOne).not.toHaveBeenCalled();
        },
      );

      it('only moves a queued job: the status guard is part of the statement', async () => {
        query.mockResolvedValue([[], 0]);
        await repo.claim('job-1');
        const [sql, params] = query.mock.calls[0];
        expect(sql).toMatch(/WHERE id = \$1 AND "status" = 'queued'/);
        expect(sql).toMatch(/"attempts" = "attempts" \+ 1/);
        expect(params).toEqual(['job-1']);
      });
    });

    describe('settle', () => {
      it('is true when a running job was settled, false when it was not (reconciled away)', async () => {
        query
          .mockResolvedValueOnce([[{ id: 'job-1' }], 1])
          .mockResolvedValueOnce([[], 0]);
        await expect(
          repo.settle('job-1', JobStatus.DONE, { result: { summary: 'ok' } }),
        ).resolves.toBe(true);
        await expect(
          repo.settle('job-1', JobStatus.DONE, { result: { summary: 'ok' } }),
        ).resolves.toBe(false);
      });

      it('settles only a job that is still running', async () => {
        query.mockResolvedValue([[], 0]);
        await repo.settle('job-1', JobStatus.FAILED, { error: 'boom' });
        expect(query.mock.calls[0][0]).toMatch(/AND "status" = 'running'/);
      });

      it('sends the result as JSON and the error as text, null when absent', async () => {
        query.mockResolvedValue([[{ id: 'job-1' }], 1]);

        await repo.settle('job-1', JobStatus.DONE, {
          result: { summary: '8 questions', scenarioId: 4 },
        });
        expect(query.mock.calls[0][1]).toEqual([
          'job-1',
          'done',
          JSON.stringify({ summary: '8 questions', scenarioId: 4 }),
          null,
        ]);

        await repo.settle('job-1', JobStatus.FAILED, { error: 'boom' });
        expect(query.mock.calls[1][1]).toEqual([
          'job-1',
          'failed',
          null,
          'boom',
        ]);

        // A null result keeps the stored one (COALESCE) rather than blanking it.
        await repo.settle('job-1', JobStatus.SKIPPED, { result: null });
        expect(query.mock.calls[2][1][2]).toBeNull();
        expect(query.mock.calls[2][0]).toMatch(
          /COALESCE\(\$3::jsonb, "result"\)/,
        );
      });
    });

    describe('setStatus', () => {
      it('does nothing, and runs no query, for an empty id list', async () => {
        await expect(
          repo.setStatus([], [JobStatus.QUEUED], JobStatus.HELD),
        ).resolves.toEqual([]);
        expect(query).not.toHaveBeenCalled();
      });

      it('returns the ids that actually changed', async () => {
        query.mockResolvedValue([[{ id: 'a' }, { id: 'c' }], 2]);
        await expect(
          repo.setStatus(['a', 'b', 'c'], [JobStatus.QUEUED], JobStatus.HELD),
        ).resolves.toEqual(['a', 'c']);
      });

      it('passes the from-statuses, the target, and the error / attempts options as parameters', async () => {
        query.mockResolvedValue([[], 0]);

        await repo.setStatus(
          ['a'],
          [JobStatus.FAILED, JobStatus.SKIPPED],
          JobStatus.QUEUED,
          {
            error: null,
            resetAttempts: true,
          },
        );
        expect(query.mock.calls[0][1]).toEqual([
          ['a'],
          ['failed', 'skipped'],
          'queued',
          true,
          null,
          true,
        ]);

        await repo.setStatus(['a'], [JobStatus.QUEUED], JobStatus.SKIPPED);
        // No `error` key: the stored error is left alone, attempts are kept.
        expect(query.mock.calls[1][1]).toEqual([
          ['a'],
          ['queued'],
          'skipped',
          false,
          null,
          false,
        ]);
      });
    });

    it('requeueForRepair keeps attempts and only touches a running job', async () => {
      await repo.requeueForRepair('job-1', 'bad json');
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/SET "status" = 'queued', "error" = \$2/);
      expect(sql).not.toMatch(/attempts/);
      expect(sql).toMatch(/AND "status" = 'running'/);
      expect(params).toEqual(['job-1', 'bad json']);
    });

    it('heartbeat only beats a running job', async () => {
      await repo.heartbeat('job-1');
      expect(query.mock.calls[0][0]).toMatch(/AND "status" = 'running'/);
    });
  });

  describe('CourseCopilotMessageRepository.appendMessage', () => {
    let repo: CourseCopilotMessageRepository;
    beforeEach(() => {
      repo = new CourseCopilotMessageRepository(dataSource as any);
    });

    it('takes the next seq from the session counter (reading the [rows, count] tuple) and saves with it', async () => {
      txManager.query.mockResolvedValue([[{ lastMessageSeq: 7 }], 1]);

      const saved = await repo.appendMessage('session-1', {
        role: CourseCopilotMessageRole.USER,
        content: 'hello',
      });

      expect(txManager.query.mock.calls[0][1]).toEqual(['session-1']);
      expect(entityRepo.create).toHaveBeenCalledWith({
        sessionId: 'session-1',
        seq: 7,
        role: 'user',
        content: 'hello',
      });
      expect(saved).toMatchObject({ seq: 7 });
    });

    it('coerces a seq that comes back as a string', async () => {
      txManager.query.mockResolvedValue([[{ lastMessageSeq: '12' }], 1]);
      await repo.appendMessage('session-1', {
        role: CourseCopilotMessageRole.ASSISTANT,
      });
      expect(entityRepo.create.mock.calls[0][0].seq).toBe(12);
    });

    it.each([
      ['an empty tuple', [[], 0]],
      ['an empty array', []],
    ])(
      'throws NotFound for a session that does not exist (%s) — the client re-creates it',
      async (_name, result) => {
        txManager.query.mockResolvedValue(result);
        await expect(
          repo.appendMessage('gone', {
            role: CourseCopilotMessageRole.USER,
            content: 'x',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(entityRepo.save).not.toHaveBeenCalled();
      },
    );

    it('does not allocate a seq for a soft-deleted session', async () => {
      txManager.query.mockResolvedValue([[], 0]);
      await repo
        .appendMessage('s', { role: CourseCopilotMessageRole.USER })
        .catch(() => undefined);
      expect(txManager.query.mock.calls[0][0]).toMatch(/"deletedAt" IS NULL/);
    });
  });

  describe('CourseCopilotMessageRepository.closeInterruptedMessages', () => {
    it('closes streaming assistant rows left behind by a dead turn, keeping any stop reason', async () => {
      const repo = new CourseCopilotMessageRepository(dataSource as any);
      jest.spyOn(repo, 'find').mockResolvedValue([
        { id: 'm3', metadata: { streaming: true } },
        { id: 'm2', metadata: { streaming: false } },
        { id: 'm1', metadata: { streaming: true, stopReason: 'tool_use' } },
        { id: 'm0', metadata: null },
      ] as any);
      const update = jest
        .spyOn(repo, 'update')
        .mockResolvedValue(undefined as any);

      await expect(repo.closeInterruptedMessages('session-1')).resolves.toBe(2);

      expect(update).toHaveBeenCalledWith('m3', {
        metadata: {
          streaming: false,
          interrupted: true,
          stopReason: 'interrupted',
        },
      });
      expect(update).toHaveBeenCalledWith('m1', {
        metadata: {
          streaming: false,
          interrupted: true,
          stopReason: 'tool_use',
        },
      });
      expect(update).toHaveBeenCalledTimes(2);
    });
  });

  describe('CourseCopilotEventRepository.appendBatch', () => {
    let repo: CourseCopilotEventRepository;
    beforeEach(() => {
      repo = new CourseCopilotEventRepository(dataSource as any);
    });

    const event = (type: CourseCopilotEventType, n: number) => ({
      type,
      payload: { n },
    });

    it('allocates a contiguous run of seqs ending at the session counter', async () => {
      // The counter was bumped by 3 and now reads 12 → this batch is 10, 11, 12.
      txManager.query.mockResolvedValue([[{ lastEventSeq: 12 }], 1]);

      const saved = await repo.appendBatch('session-1', [
        event(CourseCopilotEventType.JOB_STARTED, 1),
        event(CourseCopilotEventType.JOB_PROGRESS, 2),
        event(CourseCopilotEventType.JOB_DONE, 3),
      ]);

      expect(txManager.query.mock.calls[0][1]).toEqual(['session-1', 3]);
      expect(saved.map((row: any) => [row.seq, row.type])).toEqual([
        [10, 'job_started'],
        [11, 'job_progress'],
        [12, 'job_done'],
      ]);
    });

    it('allocates a single event as one seq', async () => {
      txManager.query.mockResolvedValue([[{ lastEventSeq: '1' }], 1]);
      const saved = await repo.appendBatch('session-1', [
        event(CourseCopilotEventType.BUILD_STARTED, 1),
      ]);
      expect(saved.map((row: any) => row.seq)).toEqual([1]);
    });

    it('does nothing for an empty batch', async () => {
      await expect(repo.appendBatch('session-1', [])).resolves.toEqual([]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns no events (instead of throwing) when the session is gone', async () => {
      txManager.query.mockResolvedValue([[], 0]);
      await expect(
        repo.appendBatch('gone', [event(CourseCopilotEventType.JOB_DONE, 1)]),
      ).resolves.toEqual([]);
      expect(entityRepo.save).not.toHaveBeenCalled();
    });
  });
});
