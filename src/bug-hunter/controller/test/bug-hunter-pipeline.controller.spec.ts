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
  let finderDataService: { getRecentErrors: jest.Mock };
  let telemetryService: { timed: jest.Mock };
  let bugFindingService: { listKnownNonBugs: jest.Mock };
  let modelSettingsService: { get: jest.Mock };

  beforeEach(() => {
    bugHunterService = {
      getRun: jest.fn(),
      getSettings: jest.fn().mockResolvedValue({ mode: 'ai' }),
    } as never;
    finderDataService = { getRecentErrors: jest.fn() };
    bugFindingService = { listKnownNonBugs: jest.fn().mockResolvedValue([]) };
    modelSettingsService = {
      get: jest.fn().mockResolvedValue({
        engine: 'claude-code',
        defaultModel: 'claude-sonnet-5',
        escalationModel: 'claude-opus-5',
      }),
    };
    // Pass-through by default: run the fetch, hand back its result, so the
    // finder-data cases below read exactly as they did before telemetry.
    telemetryService = {
      timed: jest.fn((_runId, _kind, fetch) => fetch()),
    };
    controller = new BugHunterPipelineController(
      bugHunterService as never,
      bugFindingService as never,
      finderDataService as never,
      {} as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
      modelSettingsService as never,
      telemetryService as never,
      // Eval service: no case here reads the eval set or stores a run.
      {} as never,
      // Policy service: no case here PATCHes a finding.
      {} as never,
      // Memory service: the sweep-prompt cases render its always-on subset.
      { listActive: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  // The sweep passes `&runId=` on every finder-data read so ally-be records
  // what the agent was shown. Older workflow copies omit it and must keep
  // getting the same response, just unmeasured.
  describe('getProdLogs', () => {
    it('serves the events through the telemetry wrapper with the run named', async () => {
      finderDataService.getRecentErrors.mockResolvedValue([
        { message: 'boom', count: 3 },
      ]);

      await expect(controller.getProdLogs('ally-be', 'run-1')).resolves.toEqual(
        { events: [{ message: 'boom', count: 3 }] },
      );

      const [runId, kind, , measure, metadata] =
        telemetryService.timed.mock.calls[0];
      expect(runId).toBe('run-1');
      expect(kind).toBe('prod_logs');
      expect(metadata).toEqual({ repo: 'ally-be' });
      // A repo with no log group answers null, which is zero items, not an error.
      expect(measure(null)).toEqual({ itemCount: 0, chars: 0 });
      expect(measure([{ a: 1 }, { b: 2 }]).itemCount).toBe(2);
    });

    it('still answers when no run is named', async () => {
      finderDataService.getRecentErrors.mockResolvedValue(null);
      await expect(controller.getProdLogs('ally-web')).resolves.toEqual({
        events: null,
      });
      expect(telemetryService.timed.mock.calls[0][0]).toBeUndefined();
    });
  });

  // The sweep protocol has to know which CLI will run it: Gemini has no Task
  // tool, so its Verify phase cannot be the Claude one. The engine is read
  // from the same settings row the workflow resolves a step later.
  describe('getSweepPrompt', () => {
    it('renders the Claude protocol when the configured engine is claude-code', async () => {
      const prompt = await controller.getSweepPrompt('ally-be', 'run-1');
      expect(prompt).toContain('subagent_type "bug-verifier"');
      expect(prompt).not.toContain('"verificationUnavailable":true');
    });

    it('renders the no-verifier protocol when the configured engine is gemini', async () => {
      modelSettingsService.get.mockResolvedValue({
        engine: 'gemini',
        defaultModel: 'gemini-2.5-pro',
        escalationModel: 'claude-opus-5',
      });
      const prompt = await controller.getSweepPrompt('ally-be', 'run-1');
      expect(prompt).not.toContain('subagent_type "bug-verifier"');
      expect(prompt).toContain('"verificationUnavailable":true');
    });
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
