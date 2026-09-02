import { GlossaryConsolidationSchedulerRegistrationService } from '../glossary-consolidation-scheduler-registration.service';

describe('GlossaryConsolidationSchedulerRegistrationService', () => {
  let glossaryService: any;
  let service: GlossaryConsolidationSchedulerRegistrationService;
  const envBackup = { ...process.env };

  beforeEach(() => {
    glossaryService = {
      queryCandidateLanguages: jest.fn().mockResolvedValue([{ id: 6 }]),
      countUnconsumedAnnotations: jest.fn().mockResolvedValue(0),
      listConsolidationBatches: jest.fn().mockResolvedValue([]),
      consolidateGlossary: jest.fn().mockResolvedValue({
        proposed: 1,
        autoAccepted: 1,
        batchId: 'b1',
      }),
    };
    service = new GlossaryConsolidationSchedulerRegistrationService(
      glossaryService,
    );
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  // The floor exists because a standing backlog keeps the data trigger
  // permanently true: without it, the 30-minute eligibility tick BECOMES the
  // cadence. Measured in production — 197-200 annotations consolidated per
  // language, 48 times a day, on a nominally daily interval.
  it('does NOT fire on the data threshold inside the minimum gap', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(300);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 2 * 3600_000) }, // 2h ago
    ]);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).not.toHaveBeenCalled();
  });

  it('fires on the data threshold once past the minimum gap, before the weekly interval', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(30);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 30 * 3600_000) }, // >24h, <168h
    ]);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledWith(
      6,
      'scheduler',
      { autoAccept: true, trigger: 'scheduled' },
    );
  });

  it('fires on the weekly interval when any unconsumed data exists', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(3); // below threshold
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 8 * 24 * 3600_000) }, // 8 days
    ]);
    await service.tick('propose');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledWith(
      6,
      'scheduler',
      { autoAccept: false, trigger: 'scheduled' },
    );
  });

  // 48h used to trigger the interval; weekly means it no longer does.
  it('stays quiet below threshold two days after the last batch', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(3);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 48 * 3600_000) },
    ]);
    await service.tick('propose');
    expect(glossaryService.consolidateGlossary).not.toHaveBeenCalled();
  });

  it('fires for a language that has never consolidated', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(1);
    glossaryService.listConsolidationBatches.mockResolvedValue([]);
    await service.tick('propose');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalled();
  });

  it('honours env overrides for the gap and interval', async () => {
    process.env.GLOSSARY_CONSOLIDATE_MIN_GAP_HOURS = '0';
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(300);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 60_000) },
    ]);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalled();
  });

  it('stays quiet below threshold with a fresh batch', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(3);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date() },
    ]);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).not.toHaveBeenCalled();
  });

  it('skips languages with nothing unconsumed even when the interval elapsed', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(0);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).not.toHaveBeenCalled();
  });

  it('one failing language never starves the rest', async () => {
    glossaryService.queryCandidateLanguages.mockResolvedValue([
      { id: 6 },
      { id: 7 },
    ]);
    glossaryService.countUnconsumedAnnotations
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(30);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 30 * 3600_000) },
    ]);
    glossaryService.consolidateGlossary
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ proposed: 1, autoAccepted: 0, batchId: 'b2' });
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledTimes(2);
  });
});
