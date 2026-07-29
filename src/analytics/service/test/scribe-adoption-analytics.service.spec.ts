import { Test, TestingModule } from '@nestjs/testing';
import { ScribeAdoptionAnalyticsService } from '../scribe-adoption-analytics.service';
import {
  ScribeAdoptionAnalyticsRepository,
  ScribeAdoptionRow,
} from '../../repository/scribe-adoption-analytics.repository';

// Fixed "now" = 2024-06-12T12:00:00Z. range='12m' -> monthly buckets
// 2023-07-01 .. 2024-06-01, with June still in progress.
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const emptyTotals: ScribeAdoptionRow = {
  bucket: '',
  orgs: 0,
  counsellors: 0,
  sessions: 0,
};

describe('ScribeAdoptionAnalyticsService', () => {
  let service: ScribeAdoptionAnalyticsService;
  let repository: jest.Mocked<ScribeAdoptionAnalyticsRepository>;

  const setup = async (opts?: {
    points?: ScribeAdoptionRow[];
    totals?: ScribeAdoptionRow;
    dataFloor?: Date;
  }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScribeAdoptionAnalyticsService,
        {
          provide: ScribeAdoptionAnalyticsRepository,
          useValue: {
            getDataFloor: jest
              .fn()
              .mockResolvedValue(
                opts?.dataFloor ?? new Date('2024-02-01T00:00:00.000Z'),
              ),
            getAdoptionByBucket: jest
              .fn()
              .mockResolvedValue(opts?.points ?? []),
            getTotals: jest.fn().mockResolvedValue(opts?.totals ?? emptyTotals),
          },
        },
      ],
    }).compile();

    service = module.get(ScribeAdoptionAnalyticsService);
    repository = module.get(ScribeAdoptionAnalyticsRepository);
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(FIXED_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('defaults to an all-time monthly window, measured from the shared data floor', async () => {
    await setup({ dataFloor: new Date('2024-03-01T00:00:00.000Z') });

    const result = await service.getScribeAdoption({});

    expect(repository.getDataFloor).toHaveBeenCalled();
    expect(result.window.allTime).toBe(true);
    expect(result.window.bucket).toBe('month');
    expect(result.points.map((p) => p.bucket)).toEqual([
      '2024-03-01',
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('gap-fills every bucket with zeros — a month nobody used Scribe is a measurement', async () => {
    await setup({
      points: [
        { bucket: '2024-04-01', orgs: 3, counsellors: 11, sessions: 140 },
        { bucket: '2024-05-01', orgs: 5, counsellors: 19, sessions: 260 },
      ],
    });

    const result = await service.getScribeAdoption({ range: '12m' });

    expect(result.points).toHaveLength(12);
    expect(result.points[0].bucket).toBe('2023-07-01');
    expect(result.points[0]).toEqual({
      bucket: '2023-07-01',
      orgs: 0,
      counsellors: 0,
      sessions: 0,
    });
    const april = result.points.find((p) => p.bucket === '2024-04-01')!;
    expect(april).toEqual({
      bucket: '2024-04-01',
      orgs: 3,
      counsellors: 11,
      sessions: 140,
    });
  });

  it('takes the window totals from their own pass rather than summing the buckets', async () => {
    await setup({
      points: [
        { bucket: '2024-04-01', orgs: 3, counsellors: 11, sessions: 140 },
        { bucket: '2024-05-01', orgs: 5, counsellors: 19, sessions: 260 },
      ],
      // The same three orgs came back in May: eight org-months, five customers.
      totals: { bucket: '', orgs: 5, counsellors: 22, sessions: 400 },
    });

    const result = await service.getScribeAdoption({ range: '12m' });

    expect(result.summary.orgs).toBe(5);
    expect(result.summary.counsellors).toBe(22);
    expect(result.summary.sessions).toBe(400);
    // Summing the bars would have said 8 orgs and 30 counsellors.
    expect(repository.getTotals).toHaveBeenCalled();
  });

  it('quotes "currently live" from the latest COMPLETE bucket, not the accruing one', async () => {
    await setup({
      points: [
        { bucket: '2024-05-01', orgs: 5, counsellors: 19, sessions: 260 },
        // June is only twelve days old — its figure can only rise.
        { bucket: '2024-06-01', orgs: 2, counsellors: 6, sessions: 40 },
      ],
    });

    const result = await service.getScribeAdoption({ range: '12m' });

    expect(result.window.inProgressBucket).toBe('2024-06-01');
    expect(result.summary.latestCompleteBucket).toBe('2024-05-01');
    expect(result.summary.latestOrgs).toBe(5);
  });

  it('reports a genuine zero for a complete-but-empty latest bucket', async () => {
    await setup({ points: [] });

    const result = await service.getScribeAdoption({ range: '12m' });

    expect(result.summary.latestCompleteBucket).toBe('2024-05-01');
    // Zero, not null: the bucket finished and nobody used Scribe in it.
    expect(result.summary.latestOrgs).toBe(0);
  });

  it('passes a trimmed tenant filter to both queries and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getScribeAdoption({
      range: '12m',
      tenantId: '  ally  ',
    });

    expect(repository.getAdoptionByBucket).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'month',
      'ally',
    );
    expect(repository.getTotals).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });
});
