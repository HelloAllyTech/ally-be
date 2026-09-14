import { BuilderAttemptService } from '../builder-attempt.service';

/**
 * The model-selection dataset.
 *
 * Every assertion here protects the same thing: that a reward is attributed to
 * the arm that actually earned it. A policy trained on mis-attributed rewards
 * is worse than no policy, because it is confidently wrong and nothing in the
 * numbers looks broken.
 */
describe('BuilderAttemptService', () => {
  const run = {
    id: 'run-1',
    sessionId: 'sess-1',
    engine: 'claude-code',
  } as any;

  const repo = (over: Record<string, any> = {}) => ({
    findOne: jest.fn().mockResolvedValue(over.previous ?? null),
    findNewest: jest.fn().mockResolvedValue(over.newest ?? null),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  });

  describe('recordArm', () => {
    it('records the first attempt without calling it an escalation', async () => {
      const repository = repo();

      await new BuilderAttemptService(repository as never).recordArm(
        run,
        'code-1',
        { model: 'claude-sonnet-5', totalCostUsd: 1.25, numTurns: 30 },
      );

      const [row] = repository.upsert.mock.calls[0];
      expect(row).toMatchObject({
        runId: 'run-1',
        attempt: 1,
        phase: 'code',
        model: 'claude-sonnet-5',
        ladderIndex: 0,
        escalated: false,
        costUsd: '1.25',
      });
      // Nothing to compare attempt 1 against.
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('marks an escalation when the tier actually moved', async () => {
      const repository = repo({ previous: { model: 'claude-sonnet-5' } });

      await new BuilderAttemptService(repository as never).recordArm(
        run,
        'code-3',
        { model: 'claude-opus-5', totalCostUsd: 4 },
      );

      expect(repository.upsert.mock.calls[0][0]).toMatchObject({
        attempt: 3,
        escalated: true,
      });
    });

    it('does not call a retry on the same tier an escalation', async () => {
      const repository = repo({ previous: { model: 'claude-sonnet-5' } });

      await new BuilderAttemptService(repository as never).recordArm(
        run,
        'code-2',
        { model: 'claude-sonnet-5' },
      );

      expect(repository.upsert.mock.calls[0][0].escalated).toBe(false);
    });

    /** plan, verify-2 and finalise are not coding attempts. */
    it('ignores phases that are not coding attempts', async () => {
      const repository = repo();
      const service = new BuilderAttemptService(repository as never);

      await service.recordArm(run, 'plan', { model: 'claude-opus-5' });
      await service.recordArm(run, 'verify-1', { model: 'claude-opus-5' });
      await service.recordArm(run, 'finalise', { model: 'claude-sonnet-5' });

      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('ignores a report with no model rather than storing a blank arm', async () => {
      const repository = repo();

      await new BuilderAttemptService(repository as never).recordArm(
        run,
        'code-1',
        { totalCostUsd: 2 },
      );

      expect(repository.upsert).not.toHaveBeenCalled();
    });

    /** Telemetry must never be able to fail the build that produced it. */
    it('swallows a write failure', async () => {
      const repository = repo();
      repository.upsert.mockRejectedValue(new Error('db down'));

      await expect(
        new BuilderAttemptService(repository as never).recordArm(
          run,
          'code-1',
          {
            model: 'claude-sonnet-5',
          },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('recordGate', () => {
    /**
     * One gate run emits a verdict per repo. A cross-repo build that passed
     * ally-be and broke ally-web has not passed, and a blind per-repo write
     * would leave whichever verdict happened to land last.
     */
    it('keeps a failure once any repo has failed', async () => {
      const repository = repo({
        newest: { id: 'a-1', gatePassed: false, newFailureCount: 2 },
      });

      await new BuilderAttemptService(repository as never).recordGate(run, {
        passed: true,
        newFailures: [],
      });

      expect(repository.update.mock.calls[0][1]).toMatchObject({
        gatePassed: false,
        producedFinalDiff: false,
      });
    });

    it('accumulates failure counts across repos', async () => {
      const repository = repo({
        newest: { id: 'a-1', gatePassed: null, newFailureCount: 2 },
      });

      await new BuilderAttemptService(repository as never).recordGate(run, {
        passed: false,
        newFailures: ['x', 'y', 'z'],
      });

      expect(repository.update.mock.calls[0][1].newFailureCount).toBe(5);
    });

    /**
     * The delayed reward — merged, reverted, fix runs — belongs to exactly one
     * attempt. Crediting it to every attempt would pay the cheap tier that
     * failed twice for work the expensive tier finished.
     */
    it('credits the passing attempt as the one whose diff shipped', async () => {
      const repository = repo({
        newest: { id: 'a-3', gatePassed: null, newFailureCount: 0 },
      });

      await new BuilderAttemptService(repository as never).recordGate(run, {
        passed: true,
        newFailures: [],
      });

      expect(repository.update.mock.calls[0][1]).toMatchObject({
        gatePassed: true,
        producedFinalDiff: true,
      });
    });

    it('does nothing when no attempt has been recorded yet', async () => {
      const repository = repo({ newest: null });

      await new BuilderAttemptService(repository as never).recordGate(run, {
        passed: true,
      });

      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
