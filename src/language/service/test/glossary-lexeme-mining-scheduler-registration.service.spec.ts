import { GlossaryLexemeMiningSchedulerRegistrationService } from '../glossary-lexeme-mining-scheduler-registration.service';

describe('GlossaryLexemeMiningSchedulerRegistrationService', () => {
  const envBackup = { ...process.env };
  let dataSource: any;
  let mining: any;
  let jobs: any;
  let service: GlossaryLexemeMiningSchedulerRegistrationService;

  beforeEach(() => {
    dataSource = {
      query: jest.fn().mockResolvedValue([
        { id: 6, value: 'ta-IN' },
        { id: 8, value: 'kn-IN' },
      ]),
    };
    mining = { mineLexemes: jest.fn().mockResolvedValue({ stats: {} }) };
    // runExclusive runs the work and returns the settled record.
    jobs = {
      runExclusive: jest.fn(async (_k, _id, _o, run) => ({
        status: 'succeeded',
        result: await run(),
      })),
    };
    service = new GlossaryLexemeMiningSchedulerRegistrationService(
      dataSource,
      mining,
      jobs,
    );
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('mines every candidate language in write mode, one after another', async () => {
    await service.tick('write');
    expect(jobs.runExclusive).toHaveBeenCalledTimes(2);
    expect(
      jobs.runExclusive.mock.calls.map((c: any[]) => [c[0], c[1]]),
    ).toEqual([
      ['lexeme-mining', 6],
      ['lexeme-mining', 8],
    ]);
    expect(mining.mineLexemes).toHaveBeenCalledWith(
      6,
      { dryRun: false },
      'scheduler',
    );
  });

  it('writes nothing in dry mode', async () => {
    await service.tick('dry');
    expect(mining.mineLexemes).toHaveBeenCalledWith(
      8,
      { dryRun: true },
      'scheduler',
    );
  });

  it('skips a language a manual run already holds, and keeps going', async () => {
    jobs.runExclusive.mockResolvedValueOnce(null);
    await service.tick('write');
    expect(mining.mineLexemes).toHaveBeenCalledTimes(1);
    expect(mining.mineLexemes).toHaveBeenCalledWith(
      8,
      expect.anything(),
      'scheduler',
    );
  });

  it('isolates a failing language from the rest', async () => {
    jobs.runExclusive.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.tick('write')).resolves.toBeUndefined();
    expect(jobs.runExclusive).toHaveBeenCalledTimes(2);
  });

  it('defaults to write and honours off', () => {
    delete process.env.GLOSSARY_LEXEME_MINING_SCHEDULE;
    expect((service as any).mode()).toBe('write');
    process.env.GLOSSARY_LEXEME_MINING_SCHEDULE = 'off';
    expect((service as any).mode()).toBe('off');
    process.env.GLOSSARY_LEXEME_MINING_SCHEDULE = 'dry';
    expect((service as any).mode()).toBe('dry');
  });
});
