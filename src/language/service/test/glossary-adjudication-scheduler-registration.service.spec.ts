import { GlossaryAdjudicationSchedulerRegistrationService } from '../glossary-adjudication-scheduler-registration.service';

describe('GlossaryAdjudicationSchedulerRegistrationService', () => {
  let adjudication: any;
  let glossaryService: any;
  let service: GlossaryAdjudicationSchedulerRegistrationService;
  const envBackup = { ...process.env };

  beforeEach(() => {
    adjudication = {
      adjudicateLanguage: jest.fn().mockResolvedValue({
        considered: 2,
        accepted: 1,
        rejected: 1,
        deferred: 0,
        proposals: [
          {
            sectionCode: 'core_style',
            entryId: 'e1',
            verdict: 'accepted',
            reason: 'ok',
          },
          {
            sectionCode: 'core_style',
            entryId: 'e2',
            verdict: 'rejected',
            reason: 'persona',
          },
        ],
      }),
    };
    glossaryService = {
      queryCandidateLanguages: jest
        .fn()
        .mockResolvedValue([{ id: 6 }, { id: 2 }]),
    };
    service = new GlossaryAdjudicationSchedulerRegistrationService(
      adjudication,
      glossaryService,
    );
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('applies verdicts in apply mode', async () => {
    await service.tick('apply');
    expect(adjudication.adjudicateLanguage).toHaveBeenCalledWith(6, {
      apply: true,
      adjudicatedBy: 'scheduler',
    });
    expect(adjudication.adjudicateLanguage).toHaveBeenCalledTimes(2);
  });

  // The way to watch it work on real data before letting it write.
  it('decides but writes nothing in preview mode', async () => {
    await service.tick('preview');
    expect(adjudication.adjudicateLanguage).toHaveBeenCalledWith(6, {
      apply: false,
      adjudicatedBy: 'scheduler',
    });
  });

  it('one failing language never starves the rest', async () => {
    adjudication.adjudicateLanguage
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        considered: 1,
        accepted: 1,
        rejected: 0,
        deferred: 0,
        proposals: [],
      });
    await service.tick('apply');
    expect(adjudication.adjudicateLanguage).toHaveBeenCalledTimes(2);
  });

  it('registers as an hourly task, matching the once-a-day proposal cadence', () => {
    const registry =
      require('../../../scheduler/registry/scheduled-task.registry').scheduledTaskRegistry;
    const spy = jest
      .spyOn(registry, 'register')
      .mockImplementation(() => undefined);
    service.onModuleInit();
    expect(spy).toHaveBeenCalledWith(
      'hourly',
      'glossary-adjudication',
      expect.any(Function),
    );
    spy.mockRestore();
  });

  // A deploy must not start writing to live prompts on its own.
  it('is a no-op until the flag is set deliberately', async () => {
    delete process.env.GLOSSARY_ADJUDICATION_SCHEDULE;
    const registry =
      require('../../../scheduler/registry/scheduled-task.registry').scheduledTaskRegistry;
    let handler: (() => Promise<void>) | undefined;
    const spy = jest.spyOn(registry, 'register').mockImplementation(((
      _i: string,
      _n: string,
      h: () => Promise<void>,
    ) => {
      handler = h;
    }) as any);
    service.onModuleInit();
    spy.mockRestore();
    await handler!();
    expect(adjudication.adjudicateLanguage).not.toHaveBeenCalled();
  });
});
