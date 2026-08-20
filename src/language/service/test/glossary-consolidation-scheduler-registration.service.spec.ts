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

  it('fires on the data threshold regardless of batch age', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(30);
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date() }, // fresh batch — interval NOT elapsed
    ]);
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledWith(
      6,
      'scheduler',
      { autoAccept: true, trigger: 'scheduled' },
    );
  });

  it('fires on the interval when any unconsumed data exists', async () => {
    glossaryService.countUnconsumedAnnotations.mockResolvedValue(3); // below threshold
    glossaryService.listConsolidationBatches.mockResolvedValue([
      { createdAt: new Date(Date.now() - 48 * 3600_000) },
    ]);
    await service.tick('propose');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledWith(
      6,
      'scheduler',
      { autoAccept: false, trigger: 'scheduled' },
    );
  });

  it('stays quiet below threshold inside the interval', async () => {
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
    glossaryService.consolidateGlossary
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ proposed: 1, autoAccepted: 0, batchId: 'b2' });
    await service.tick('auto');
    expect(glossaryService.consolidateGlossary).toHaveBeenCalledTimes(2);
  });
});
