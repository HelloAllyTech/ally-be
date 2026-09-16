import { BuilderEventType } from '../../enum/builder.enum';
import { BuilderBuildService } from '../builder-build.service';

/**
 * A run that changed nothing is not a run that failed.
 *
 * The gate rule exists because "I fixed it" cannot be checked any other way. It
 * was applied to every `done`, including runs that made no claim at all — and on
 * 2026-09-16 two fix runs did exactly the right thing (read the feedback, found
 * it was Builder's own approval, said so on the pull request, changed no code)
 * and were recorded FAILED for it. That lit a red banner on a healthy session,
 * marked the build failed in the UI, and counted toward the circuit breaker
 * that stops automatic work.
 *
 * `file_edit` is the evidence, and it is machine-emitted: the forwarder derives
 * it from the engine's own output rather than taking the agent's word, so a run
 * cannot claim it changed nothing while having edited files.
 */
describe('BuilderBuildService.touchedNoFiles', () => {
  const build = (events: { type: BuilderEventType }[]) => {
    const eventRepository = { listByRun: jest.fn().mockResolvedValue(events) };
    const service = Object.create(
      BuilderBuildService.prototype,
    ) as BuilderBuildService;
    (service as unknown as { eventRepository: unknown }).eventRepository =
      eventRepository;
    return service;
  };

  it('is true for a run that edited nothing', async () => {
    const service = build([
      { type: BuilderEventType.TEXT },
      { type: BuilderEventType.TOOL_CALL },
    ]);

    await expect(service.touchedNoFiles('run-1')).resolves.toBe(true);
  });

  it('is false as soon as one file was edited', async () => {
    const service = build([
      { type: BuilderEventType.TEXT },
      { type: BuilderEventType.FILE_EDIT },
    ]);

    await expect(service.touchedNoFiles('run-1')).resolves.toBe(false);
  });

  /**
   * A run with no events at all edited nothing. Treating the empty case as
   * "changed something" would put back exactly the failure this removes.
   */
  it('is true for a run with no events', async () => {
    await expect(build([]).touchedNoFiles('run-1')).resolves.toBe(true);
  });
});
