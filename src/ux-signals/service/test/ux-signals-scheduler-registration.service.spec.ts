import { Test, TestingModule } from '@nestjs/testing';

import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import { UxSignalsSchedulerRegistrationService } from '../ux-signals-scheduler-registration.service';
import { UxSignalsService } from '../ux-signals.service';
import { UxSignalScanTrigger } from '../../enum/ux-signal.enum';

/**
 * The hourly tick does two things, and the second one is conditional.
 *
 * Clearing an abandoned scan row is not part of running a scan: a row left
 * RUNNING by a crash or a redeploy is what the admin panel reads as "a scan is
 * running now", and it has to be cleared on a schedule of its own — otherwise
 * nothing touches it until the next scan is attempted, which on the daily cadence
 * can be most of a day later.
 */
describe('UxSignalsSchedulerRegistrationService', () => {
  let tick: () => Promise<void>;
  let sweepAbandonedScans: jest.Mock;
  let isDueForScheduledScan: jest.Mock;
  let runScan: jest.Mock;

  beforeEach(async () => {
    sweepAbandonedScans = jest.fn().mockResolvedValue(0);
    isDueForScheduledScan = jest.fn().mockResolvedValue(true);
    runScan = jest.fn().mockResolvedValue({
      scanId: 'scan-1',
      signalsDetected: 0,
      findingsCreated: 0,
      suggestionsCreated: 0,
      skippedDuplicates: 0,
      failedDetectors: [],
    });

    const register = jest
      .spyOn(scheduledTaskRegistry, 'register')
      .mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UxSignalsSchedulerRegistrationService,
        {
          provide: UxSignalsService,
          useValue: { sweepAbandonedScans, isDueForScheduledScan, runScan },
        },
      ],
    }).compile();

    module.get(UxSignalsSchedulerRegistrationService).onModuleInit();

    const [interval, name, handler] = register.mock.calls[0];
    expect(interval).toBe('hourly');
    expect(name).toBe('ux-signals-scan');
    tick = handler;
  });

  afterEach(() => jest.restoreAllMocks());

  it('sweeps abandoned rows on every tick, not only when a scan is due', async () => {
    // The whole point of putting the sweep on a timer: a dead row is stale
    // whether or not today's scan has already run.
    isDueForScheduledScan.mockResolvedValue(false);

    await tick();

    expect(sweepAbandonedScans).toHaveBeenCalledTimes(1);
    expect(runScan).not.toHaveBeenCalled();
  });

  it('sweeps before the scan, so a row abandoned mid-run cannot block it', async () => {
    await tick();

    expect(sweepAbandonedScans.mock.invocationCallOrder[0]).toBeLessThan(
      runScan.mock.invocationCallOrder[0],
    );
    expect(runScan).toHaveBeenCalledWith(UxSignalScanTrigger.SCHEDULED);
  });

  it('still runs the scan when the sweep itself fails', async () => {
    // The sweep is housekeeping. Letting its failure cancel the scan would trade
    // a stale row for a missed day of telemetry.
    sweepAbandonedScans.mockRejectedValue(new Error('database unavailable'));

    await expect(tick()).resolves.toBeUndefined();

    expect(runScan).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed scan rather than noising up the shared runner', async () => {
    // A scheduled scan is best-effort and its failure is already on the scan row.
    runScan.mockRejectedValue(new Error('PostHog unreachable'));

    await expect(tick()).resolves.toBeUndefined();
  });
});
