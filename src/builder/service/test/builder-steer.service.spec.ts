import { BadRequestException } from '@nestjs/common';
import { BuilderSteerService } from '../builder-steer.service';
import { BuilderSteerStatus } from '../../enum/builder.enum';
import { BUILDER_STEER_MAX_LENGTH } from '../../constants/builder.constants';

/**
 * Redirecting a build rather than cancelling it.
 *
 * The properties worth a test are the ones that decide whether a person's
 * correction actually arrives:
 *
 *  1. Acknowledging is scoped to the session's own pending rows. The runner
 *     authenticates with the shared pipeline key, so an id list it sends is
 *     not evidence the notes are its to close.
 *  2. A note that was never delivered never reads as DELIVERED — the status
 *     vocabulary is the only thing standing between "it was told and ignored
 *     it" and "it never heard".
 */
describe('BuilderSteerService', () => {
  const repo = (pending: any[] = []) => ({
    create: (row: any) => row,
    save: jest.fn().mockImplementation((row) => ({ id: 's1', ...row })),
    listPending: jest.fn().mockResolvedValue(pending),
    listBySession: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  });

  describe('add', () => {
    it('queues a note as pending against the session, not the run', async () => {
      const repository = repo();
      const steer = await new BuilderSteerService(repository as never).add(
        'sess-1',
        '  use the existing repository, do not add a second one  ',
        { runId: 'run-9', userId: 42 },
      );

      expect(steer.sessionId).toBe('sess-1');
      // Trimmed, because the note is pasted straight into a prompt.
      expect(steer.note).toBe(
        'use the existing repository, do not add a second one',
      );
      expect(steer.status).toBe(BuilderSteerStatus.PENDING);
      // Recorded for the audit trail, but the note is addressed to the
      // session: a retry is a new run and the correction still applies.
      expect(steer.runId).toBe('run-9');
      expect(steer.createdByUserId).toBe(42);
    });

    it('refuses an empty note rather than queueing a blank prompt append', async () => {
      await expect(
        new BuilderSteerService(repo() as never).add('sess-1', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a note longer than a correction', async () => {
      await expect(
        new BuilderSteerService(repo() as never).add(
          'sess-1',
          'x'.repeat(BUILDER_STEER_MAX_LENGTH + 1),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('acknowledge', () => {
    it("marks only the session's own pending notes delivered", async () => {
      const repository = repo([{ id: 'a' }, { id: 'b' }]);
      const service = new BuilderSteerService(repository as never);

      const count = await service.acknowledge(
        'sess-1',
        'run-9',
        ['a', 'not-this-session'],
        'gate',
      );

      expect(count).toBe(1);
      expect(repository.update).toHaveBeenCalledWith(
        ['a'],
        expect.objectContaining({
          status: BuilderSteerStatus.DELIVERED,
          deliveredToRunId: 'run-9',
          deliveredAtPhase: 'gate',
        }),
      );
    });

    it('writes nothing when none of the ids are pending here', async () => {
      const repository = repo([{ id: 'a' }]);
      const service = new BuilderSteerService(repository as never);

      const count = await service.acknowledge('sess-1', 'run-9', ['zzz']);

      expect(count).toBe(0);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('writes nothing for an empty ack', async () => {
      const repository = repo([{ id: 'a' }]);
      await new BuilderSteerService(repository as never).acknowledge(
        'sess-1',
        'run-9',
        [],
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('supersedePending', () => {
    /**
     * The distinction the whole status enum exists for. A note closed out
     * because its session ended was never read, and a row claiming otherwise
     * would misreport what the build was told.
     */
    it('closes pending notes as superseded, never as delivered', async () => {
      const repository = repo([{ id: 'a' }, { id: 'b' }]);

      const count = await new BuilderSteerService(
        repository as never,
      ).supersedePending('sess-1');

      expect(count).toBe(2);
      expect(repository.update).toHaveBeenCalledWith(['a', 'b'], {
        status: BuilderSteerStatus.SUPERSEDED,
      });
    });

    it('is a no-op when the queue is empty', async () => {
      const repository = repo([]);
      await new BuilderSteerService(repository as never).supersedePending('s');
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
