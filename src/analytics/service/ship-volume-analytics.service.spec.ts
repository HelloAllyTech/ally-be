import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ShipVolumeAnalyticsService } from './ship-volume-analytics.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ShipVolumeAnalyticsService', () => {
  let service: ShipVolumeAnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipVolumeAnalyticsService,
        {
          provide: AppConfigService,
          useValue: {
            githubToken: 'test-token',
            githubOrg: 'HelloAllyTech',
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
          },
        },
      ],
    }).compile();

    service = module.get<ShipVolumeAnalyticsService>(
      ShipVolumeAnalyticsService,
    );

    // Mock logger to suppress output during tests
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getShipVolume', () => {
    it('should not fetch the "infra" repository', async () => {
      mockedAxios.get.mockResolvedValue({ data: [], status: 200 });

      const result = await service.getShipVolume();

      expect(result.unavailableRepos).toHaveLength(0);

      const infraUrl = `https://api.github.com/repos/HelloAllyTech/infra/stats/code_frequency`;
      expect(mockedAxios.get).not.toHaveBeenCalledWith(
        infraUrl,
        expect.any(Object),
      );
    });
  });
});
