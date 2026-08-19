import { Test, TestingModule } from '@nestjs/testing';
import { CertificationAnalyticsService } from '../certification-analytics.service';
import {
  CERTIFICATION_MIN_MONTHS,
  CERTIFICATION_PIPELINE_FRACTIONS,
  CertificationAnalyticsRepository,
  CertificationMonthRow,
  CertificationPipelineRow,
  PRIMARY_CERTIFICATION_LEVEL,
} from '../../repository/certification-analytics.repository';

/**
 * Fixed "now" = 2024-06-12, so the current (incomplete) month is 2024-06 and a
 * minimum-span axis runs 2023-07 .. 2024-06 inclusive (12 months).
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const BAND_COUNT = CERTIFICATION_PIPELINE_FRACTIONS.length - 1;

const pipeline = (
  overrides: Partial<CertificationPipelineRow> = {},
): CertificationPipelineRow => ({
  learners: 0,
  certified: 0,
  pipelineByBand: Array<number>(BAND_COUNT).fill(0),
  nearestMinutes: 0,
  ...overrides,
});

describe('CertificationAnalyticsService', () => {
  let service: CertificationAnalyticsService;
  let repository: jest.Mocked<CertificationAnalyticsRepository>;

  const setup = async (
    monthRows: CertificationMonthRow[] = [],
    pipelineRow: CertificationPipelineRow = pipeline(),
    firstActivityMonth: string | null = null,
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationAnalyticsService,
        {
          provide: CertificationAnalyticsRepository,
          useValue: {
            getCertificationMonths: jest.fn().mockResolvedValue(monthRows),
            getPipeline: jest.fn().mockResolvedValue(pipelineRow),
            getFirstActivityMonth: jest
              .fn()
              .mockResolvedValue(firstActivityMonth),
          },
        },
      ],
    }).compile();

    service = module.get(CertificationAnalyticsService);
    repository = module.get(CertificationAnalyticsRepository);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('the month axis', () => {
    it('spans at least the minimum months, gap-free and oldest first', async () => {
      await setup();

      const result = await service.getCertification({});

      expect(result.months).toHaveLength(CERTIFICATION_MIN_MONTHS);
      expect(result.months[0].month).toBe('2023-07-01');
      expect(result.months[result.months.length - 1].month).toBe('2024-06-01');
      expect(result.currentMonth).toBe('2024-06-01');
    });

    it('extends back to the first month anyone practised', async () => {
      await setup([], pipeline(), '2022-03-01');

      const result = await service.getCertification({});

      expect(result.months[0].month).toBe('2022-03-01');
      expect(result.months[result.months.length - 1].month).toBe('2024-06-01');
    });

    it('never starts after a certification, even one older than first activity', async () => {
      // A tenant filter can narrow the population so the two disagree; an axis
      // that started after a crossing would drop a bar the line still counts.
      await setup(
        [{ month: '2021-01-01', newlyCertified: 2 }],
        pipeline({ certified: 2, learners: 2 }),
        '2023-05-01',
      );

      const result = await service.getCertification({});

      expect(result.months[0].month).toBe('2021-01-01');
      expect(result.months[0].cumulativeCertified).toBe(2);
    });

    it('fills months with no crossings with real zeros', async () => {
      await setup(
        [{ month: '2024-01-01', newlyCertified: 3 }],
        pipeline({ certified: 3, learners: 10 }),
        '2023-11-01',
      );

      const result = await service.getCertification({});
      const december = result.months.find((m) => m.month === '2023-12-01');

      expect(december).toBeDefined();
      expect(december?.newlyCertified).toBe(0);
    });

    it('flags only the current month as partial', async () => {
      await setup();

      const result = await service.getCertification({});
      const partials = result.months.filter((m) => m.partial);

      expect(partials).toHaveLength(1);
      expect(partials[0].month).toBe('2024-06-01');
    });
  });

  describe('the cumulative line', () => {
    it('is the running total of the monthly crossings', async () => {
      await setup(
        [
          { month: '2023-08-01', newlyCertified: 2 },
          { month: '2023-10-01', newlyCertified: 3 },
          { month: '2024-02-01', newlyCertified: 1 },
        ],
        pipeline({ certified: 6, learners: 40 }),
        '2023-07-01',
      );

      const result = await service.getCertification({});
      const at = (month: string) =>
        result.months.find((m) => m.month === month)?.cumulativeCertified;

      expect(at('2023-07-01')).toBe(0);
      expect(at('2023-08-01')).toBe(2);
      expect(at('2023-09-01')).toBe(2);
      expect(at('2023-10-01')).toBe(5);
      expect(at('2024-02-01')).toBe(6);
      expect(at('2024-06-01')).toBe(6);
    });

    it('never falls', async () => {
      await setup(
        [
          { month: '2023-09-01', newlyCertified: 4 },
          { month: '2024-03-01', newlyCertified: 7 },
        ],
        pipeline({ certified: 11, learners: 60 }),
        '2023-07-01',
      );

      const result = await service.getCertification({});

      result.months.reduce((previous, m) => {
        expect(m.cumulativeCertified).toBeGreaterThanOrEqual(previous);
        return m.cumulativeCertified;
      }, 0);
    });

    it('opens at the count of crossings that predate the axis', async () => {
      // Crossings older than the axis are real certifications: folding them into
      // the opening value is what stops the curve starting below the number of
      // people who actually hold the level. `getFirstActivityMonth` is null here
      // to force the minimum-span axis, which begins 2023-07.
      await setup(
        [
          { month: '2020-05-01', newlyCertified: 9 },
          { month: '2023-08-01', newlyCertified: 1 },
        ],
        pipeline({ certified: 10, learners: 30 }),
        null,
      );

      const result = await service.getCertification({});

      // The axis is pulled back to the oldest crossing rather than truncating
      // it, so the opening month IS that crossing.
      expect(result.months[0].month).toBe('2020-05-01');
      expect(result.months[0].cumulativeCertified).toBe(9);
      expect(
        result.months.find((m) => m.month === '2023-08-01')
          ?.cumulativeCertified,
      ).toBe(10);
    });
  });

  describe('the headline figures', () => {
    it('takes certified and learners from the standing snapshot', async () => {
      await setup(
        [{ month: '2024-01-01', newlyCertified: 5 }],
        pipeline({ certified: 5, learners: 250, nearestMinutes: 4210.6 }),
        '2023-01-01',
      );

      const result = await service.getCertification({});

      expect(result.certified).toBe(5);
      expect(result.learners).toBe(250);
      expect(result.nearestMinutes).toBe(4211);
    });

    it('reports zero certified without hiding the pipeline', async () => {
      await setup(
        [],
        pipeline({
          learners: 120,
          certified: 0,
          pipelineByBand: [80, 25, 10, 4, 1],
          nearestMinutes: 4800,
        }),
        '2023-02-01',
      );

      const result = await service.getCertification({});

      expect(result.certified).toBe(0);
      expect(result.months.every((m) => m.cumulativeCertified === 0)).toBe(true);
      expect(result.pipeline.reduce((sum, b) => sum + b.learners, 0)).toBe(120);
      expect(result.nearestMinutes).toBe(4800);
    });
  });

  describe('the pipeline bands', () => {
    it('turns the fractions into minute bounds against the level threshold', async () => {
      await setup(
        [],
        pipeline({ learners: 5, pipelineByBand: [1, 1, 1, 1, 1] }),
      );

      const result = await service.getCertification({});
      const threshold = PRIMARY_CERTIFICATION_LEVEL.minMinutes;

      expect(result.pipeline).toHaveLength(BAND_COUNT);
      expect(result.pipeline[0].minMinutes).toBe(0);
      expect(result.pipeline[0].minFraction).toBe(0);
      expect(result.pipeline[0].label).toMatch(/^Under /);
      expect(result.pipeline[BAND_COUNT - 1].maxMinutes).toBe(threshold);
      // Contiguous: each band starts where the previous one ended, so nobody
      // falls between two bands and nobody is counted twice.
      result.pipeline.slice(1).forEach((band, i) => {
        expect(band.minMinutes).toBe(result.pipeline[i].maxMinutes);
      });
    });

    it('index-aligns the band counts with the repository rows', async () => {
      await setup(
        [],
        pipeline({ learners: 46, pipelineByBand: [30, 9, 4, 2, 1] }),
      );

      const result = await service.getCertification({});

      expect(result.pipeline.map((b) => b.learners)).toEqual([30, 9, 4, 2, 1]);
    });
  });

  describe('scoping', () => {
    it('passes the trimmed tenant to every query and echoes it', async () => {
      await setup();

      const result = await service.getCertification({ tenantId: '  acme  ' });

      expect(repository.getCertificationMonths).toHaveBeenCalledWith(
        PRIMARY_CERTIFICATION_LEVEL.minMinutes,
        'acme',
      );
      expect(repository.getPipeline).toHaveBeenCalledWith(
        PRIMARY_CERTIFICATION_LEVEL.minMinutes,
        'acme',
      );
      expect(repository.getFirstActivityMonth).toHaveBeenCalledWith('acme');
      expect(result.scoping).toEqual({
        tenantId: 'acme',
        unscopedSections: [],
      });
    });

    it('treats a blank tenant as no filter', async () => {
      await setup();

      const result = await service.getCertification({ tenantId: '   ' });

      expect(repository.getPipeline).toHaveBeenCalledWith(
        PRIMARY_CERTIFICATION_LEVEL.minMinutes,
        undefined,
      );
      expect(result.scoping.tenantId).toBeNull();
    });
  });

  it('echoes the level list so the client names L1 from the server', async () => {
    await setup();

    const result = await service.getCertification({});

    expect(result.level).toEqual(PRIMARY_CERTIFICATION_LEVEL);
    expect(result.level.minMinutes).toBe(5000);
    expect(result.levels[0]).toEqual(PRIMARY_CERTIFICATION_LEVEL);
  });
});
