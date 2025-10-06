import { Test, TestingModule } from '@nestjs/testing';
import { MetabaseService } from '../metabase.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { CommonUtil } from '../../../common/util/common.util';
import * as jwt from 'jsonwebtoken';

describe('MetabaseService', () => {
  let service: MetabaseService;
  let mockLogger: jest.Mocked<LoggerService>;

  const mockConfig = {
    analytics: {
      metabase: {
        url: 'https://metabase.example.com',
        apiKey: 'test-api-key',
      },
    },
  };

  beforeEach(async () => {
    const mockConfigService = {
      analytics: mockConfig.analytics,
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);
    jest
      .spyOn(CommonUtil, 'generateQueryParams')
      .mockReturnValue('param1=value1&param2=value2');
    jest.spyOn(jwt, 'sign').mockReturnValue('mock-jwt-token' as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetabaseService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MetabaseService>(MetabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize successfully with valid config', () => {
      expect(service).toBeDefined();
      expect(LoggerService.getInstance).toHaveBeenCalledWith('MetabaseService');
    });

    it('should throw error when metabase URL is missing', async () => {
      const invalidConfig = {
        analytics: {
          metabase: {
            url: '',
            apiKey: 'test-api-key',
          },
        },
      };

      await expect(async () => {
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            MetabaseService,
            {
              provide: AppConfigService,
              useValue: invalidConfig,
            },
          ],
        }).compile();
        module.get<MetabaseService>(MetabaseService);
      }).rejects.toThrow('Metabase URL and API Key are required');
    });

    it('should throw error when metabase API key is missing', async () => {
      const invalidConfig = {
        analytics: {
          metabase: {
            url: 'https://metabase.example.com',
            apiKey: '',
          },
        },
      };

      await expect(async () => {
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            MetabaseService,
            {
              provide: AppConfigService,
              useValue: invalidConfig,
            },
          ],
        }).compile();
        module.get<MetabaseService>(MetabaseService);
      }).rejects.toThrow('Metabase URL and API Key are required');
    });

    it('should throw error when both URL and API key are missing', async () => {
      const invalidConfig = {
        analytics: {
          metabase: {
            url: '',
            apiKey: '',
          },
        },
      };

      await expect(async () => {
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            MetabaseService,
            {
              provide: AppConfigService,
              useValue: invalidConfig,
            },
          ],
        }).compile();
        module.get<MetabaseService>(MetabaseService);
      }).rejects.toThrow('Metabase URL and API Key are required');
    });

    it('should throw error when metabase config is undefined', async () => {
      const invalidConfig = {
        analytics: {
          metabase: undefined,
        },
      };

      await expect(async () => {
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            MetabaseService,
            {
              provide: AppConfigService,
              useValue: invalidConfig,
            },
          ],
        }).compile();
        module.get<MetabaseService>(MetabaseService);
      }).rejects.toThrow();
    });
  });

  describe('getDashboardUrl', () => {
    beforeEach(() => {
      jest.spyOn(jwt, 'sign').mockReturnValue('mock-jwt-token' as any);
    });

    it('should generate dashboard URL with parameters', async () => {
      const dashboardId = '123';
      const params = { organization_id: 'org-123', user_id: 'user-456' };
      const expectedUrl =
        'https://metabase.example.com/embed/dashboard/mock-jwt-token#bordered=true&titled=true&param1=value1&param2=value2';

      const result = await service.getDashboardUrl(dashboardId, params);

      expect(result).toBe(expectedUrl);
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Getting dashboard url for ${dashboardId} | ${params}`,
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          resource: { dashboard: 123 },
          params,
          exp: expect.any(Number),
        },
        'test-api-key',
      );
      expect(CommonUtil.generateQueryParams).toHaveBeenCalledWith(params);
    });

    it('should generate dashboard URL without parameters', async () => {
      const dashboardId = '456';
      const expectedUrl =
        'https://metabase.example.com/embed/dashboard/mock-jwt-token#bordered=true&titled=true&param1=value1&param2=value2';

      const result = await service.getDashboardUrl(dashboardId);

      expect(result).toBe(expectedUrl);
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Getting dashboard url for ${dashboardId} | undefined`,
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          resource: { dashboard: 456 },
          params: {},
          exp: expect.any(Number),
        },
        'test-api-key',
      );
      expect(CommonUtil.generateQueryParams).toHaveBeenCalledWith({});
    });

    it('should generate dashboard URL with empty parameters object', async () => {
      const dashboardId = '789';
      const params = {};
      const expectedUrl =
        'https://metabase.example.com/embed/dashboard/mock-jwt-token#bordered=true&titled=true&param1=value1&param2=value2';

      const result = await service.getDashboardUrl(dashboardId, params);

      expect(result).toBe(expectedUrl);
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Getting dashboard url for ${dashboardId} | ${params}`,
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          resource: { dashboard: 789 },
          params: {},
          exp: expect.any(Number),
        },
        'test-api-key',
      );
      expect(CommonUtil.generateQueryParams).toHaveBeenCalledWith({});
    });

    it('should handle non-numeric dashboard ID', async () => {
      const dashboardId = 'abc';
      const expectedUrl =
        'https://metabase.example.com/embed/dashboard/mock-jwt-token#bordered=true&titled=true&param1=value1&param2=value2';

      const result = await service.getDashboardUrl(dashboardId);

      expect(result).toBe(expectedUrl);
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          resource: { dashboard: NaN },
          params: {},
          exp: expect.any(Number),
        },
        'test-api-key',
      );
    });

    it('should set correct expiration time (10 minutes from now)', async () => {
      const dashboardId = '123';
      const beforeCall = Math.round(Date.now() / 1000);

      await service.getDashboardUrl(dashboardId);

      const afterCall = Math.round(Date.now() / 1000);
      const expectedExp = beforeCall + 10 * 60;

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          exp: expect.any(Number),
        }),
        'test-api-key',
      );

      const actualExp = (jwt.sign as jest.MockedFunction<typeof jwt.sign>).mock
        .calls[0][0] as any;
      expect(actualExp.exp).toBeGreaterThanOrEqual(expectedExp);
      expect(actualExp.exp).toBeLessThanOrEqual(afterCall + 10 * 60);
    });

    it('should handle JWT signing errors gracefully', async () => {
      const dashboardId = '123';

      jest.spyOn(jwt, 'sign').mockImplementation(() => {
        throw new Error('JWT signing failed');
      });

      try {
        await service.getDashboardUrl(dashboardId);
        fail('Expected method to throw an error');
      } catch (error) {
        expect(error.message).toBe('JWT signing failed');
      }
    });

    it('should handle CommonUtil.generateQueryParams errors gracefully', async () => {
      const dashboardId = '123';
      const params = { test: 'value' };

      jest.spyOn(CommonUtil, 'generateQueryParams').mockImplementation(() => {
        throw new Error('Query params generation failed');
      });

      try {
        await service.getDashboardUrl(dashboardId, params);
        fail('Expected method to throw an error');
      } catch (error) {
        expect(error.message).toBe('Query params generation failed');
      }
    });
  });

  describe('refreshDashboardUrl', () => {
    it('should return empty string and log refresh attempt', async () => {
      const dashboardId = '123';

      const result = await service.refreshDashboardUrl(dashboardId);

      expect(result).toBe('');
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Refreshing dashboard ${dashboardId}`,
      );
    });

    it('should handle different dashboard IDs', async () => {
      const dashboardIds = ['123', 'abc', 'dashboard-456'];

      for (const dashboardId of dashboardIds) {
        const result = await service.refreshDashboardUrl(dashboardId);
        expect(result).toBe('');
        expect(mockLogger.info).toHaveBeenCalledWith(
          `Refreshing dashboard ${dashboardId}`,
        );
      }
    });

    it('should handle empty dashboard ID', async () => {
      const dashboardId = '';

      const result = await service.refreshDashboardUrl(dashboardId);

      expect(result).toBe('');
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Refreshing dashboard ${dashboardId}`,
      );
    });

    it('should handle null dashboard ID', async () => {
      const dashboardId = null as any;

      const result = await service.refreshDashboardUrl(dashboardId);

      expect(result).toBe('');
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Refreshing dashboard ${dashboardId}`,
      );
    });
  });
});
