import { BugHunterPipelineController } from '../bug-hunter-pipeline.controller';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import { BugHuntRunStatus } from '../../enum/bug-hunt-run.enum';

/**
 * Direct-instantiation style, matching the rest of this module's specs — the
 * `ApiAuthGuard` on this controller only ever runs on a real HTTP request, so
 * calling the method directly needs no guard/provider scaffolding.
 */
describe('BugHunterPipelineController', () => {
  let controller: BugHunterPipelineController;
  let bugHunterService: { getRun: jest.Mock };

  beforeEach(() => {
    bugHunterService = { getRun: jest.fn() };
    controller = new BugHunterPipelineController(
      bugHunterService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  // Read by every repo's `bug-hunt-sweep.yml` the moment `claude -p` exits.
  // The CLI exits 0 even when the agent ends its turn mid-protocol, so a green
  // job proves nothing — a run still RUNNING at that point was abandoned, and
  // there is no reconcile pass that would ever notice.
  describe('getRunStatus', () => {
    it('reports a run the sweep agent left open', async () => {
      bugHunterService.getRun.mockResolvedValue({
        id: 'run-1',
        status: BugHuntRunStatus.RUNNING,
      } as BugHuntRun);

      await expect(controller.getRunStatus('run-1')).resolves.toEqual({
        status: BugHuntRunStatus.RUNNING,
      });
      expect(bugHunterService.getRun).toHaveBeenCalledWith('run-1');
    });

    it.each([
      BugHuntRunStatus.COMPLETED,
      BugHuntRunStatus.FAILED,
      BugHuntRunStatus.SKIPPED_DISABLED,
    ])('reports %s for a run that closed itself', async (status) => {
      bugHunterService.getRun.mockResolvedValue({
        id: 'run-1',
        status,
      } as BugHuntRun);

      await expect(controller.getRunStatus('run-1')).resolves.toEqual({
        status,
      });
    });

    it('exposes only the status, never the rest of the run', async () => {
      // A CI gate needs one field. Widening this to the admin controller's run
      // detail would put a run's findings and events behind the machine key
      // for no reason.
      bugHunterService.getRun.mockResolvedValue({
        id: 'run-1',
        status: BugHuntRunStatus.COMPLETED,
        repo: 'ally-be',
        totalTokenCostUsd: '12.3400',
        metadata: { errorMessage: 'something internal' },
      } as unknown as BugHuntRun);

      expect(Object.keys(await controller.getRunStatus('run-1'))).toEqual([
        'status',
      ]);
    });
  });
});
