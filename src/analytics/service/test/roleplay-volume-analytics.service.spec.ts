import { Test, TestingModule } from '@nestjs/testing';
import { RoleplayVolumeAnalyticsService } from '../roleplay-volume-analytics.service';
import {
  MIN_ROLEPLAY_VOLUME_POPULATION,
  ROLEPLAY_VOLUME_BANDS,
  ROLEPLAY_VOLUME_ZERO_BAND_LABEL,
  RoleplayVolumeAnalyticsRepository,
  RoleplayVolumeDistributionRow,
} from '../../repository/roleplay-volume-analytics.repository';

const emptyRow: RoleplayVolumeDistributionRow = {
  registeredLearners: 0,
  learnersWithAny: 0,
  learnersByBand: ROLEPLAY_VOLUME_BANDS.map(() => 0),
  totalCompleted: 0,
  medianAmongActive: null,
};

describe('RoleplayVolumeAnalyticsService', () => {
  let service: RoleplayVolumeAnalyticsService;
  let repository: jest.Mocked<RoleplayVolumeAnalyticsRepository>;

  const setup = async (row: RoleplayVolumeDistributionRow = emptyRow) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleplayVolumeAnalyticsService,
        {
          provide: RoleplayVolumeAnalyticsRepository,
          useValue: {
            getLifetimeDistribution: jest.fn().mockResolvedValue(row),
          },
        },
      ],
    }).compile();

    service = module.get(RoleplayVolumeAnalyticsService);
    repository = module.get(RoleplayVolumeAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('echoes the bands, the zero-band label and the share floor', async () => {
    await setup();

    const result = await service.getRoleplayVolume({});

    expect(result.bands).toEqual(ROLEPLAY_VOLUME_BANDS);
    expect(result.zeroBandLabel).toBe(ROLEPLAY_VOLUME_ZERO_BAND_LABEL);
    expect(result.minPopulationSize).toBe(MIN_ROLEPLAY_VOLUME_POPULATION);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('derives the zero band as population minus learners with any roleplay', async () => {
    await setup({
      registeredLearners: 100,
      learnersWithAny: 42,
      learnersByBand: [20, 10, 6, 3, 2, 1, 0],
      totalCompleted: 315,
      medianAmongActive: 4,
    });

    const result = await service.getRoleplayVolume({});

    expect(result.registeredLearners).toBe(100);
    expect(result.learnersWithAny).toBe(42);
    expect(result.learnersWithNone).toBe(58);
    expect(result.learnersByBand).toEqual([20, 10, 6, 3, 2, 1, 0]);
    expect(result.totalCompletedRoleplays).toBe(315);
    expect(result.medianAmongActiveLearners).toBe(4);
  });

  it('never returns a negative zero band, and never a population smaller than the learners in it', async () => {
    // A data anomaly: more learners with sessions than the population counting
    // them. A negative residual would render as an inverted bar, which reads as
    // a chart bug rather than as a data problem.
    await setup({
      ...emptyRow,
      registeredLearners: 3,
      learnersWithAny: 5,
      learnersByBand: [5, 0, 0, 0, 0, 0, 0],
    });

    const result = await service.getRoleplayVolume({});

    expect(result.registeredLearners).toBe(5);
    expect(result.learnersWithNone).toBe(0);
  });

  it('keeps the median null when nobody has completed a roleplay', async () => {
    await setup({ ...emptyRow, registeredLearners: 12 });

    const result = await service.getRoleplayVolume({});

    // Not zero: a median of no observations is not a median of zero.
    expect(result.medianAmongActiveLearners).toBeNull();
    expect(result.learnersWithNone).toBe(12);
  });

  it('passes a trimmed tenant filter through and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getRoleplayVolume({ tenantId: '  ally  ' });

    expect(repository.getLifetimeDistribution).toHaveBeenCalledWith('ally');
    expect(result.scoping).toEqual({
      tenantId: 'ally',
      unscopedSections: [],
    });
  });

  it('treats a blank tenant filter as no filter', async () => {
    await setup();

    await service.getRoleplayVolume({ tenantId: '   ' });

    expect(repository.getLifetimeDistribution).toHaveBeenCalledWith(undefined);
  });
});
