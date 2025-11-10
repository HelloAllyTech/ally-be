import { Test, TestingModule } from '@nestjs/testing';
import { PreferenceService } from '../preference.service';
import { Preference } from '../../entity/preference.entity';
import { RedisService } from '../../../redis/service/redis.service';
import { PreferenceName } from '../../../common/constants/user.constants';
import { PreferenceRepository } from '../../repository/preference.repository';

// Mock LoggerService
const mockLoggerInstance = {
  error: jest.fn(),
};

jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('PreferenceService', () => {
  let service: PreferenceService;
  let mockPreferenceRepository: any;
  let mockPreferenceCache: any;

  const mockPreference: Preference = {
    id: 'pref-123',
    name: PreferenceName.NUDGE_STATUS,
    relatedId: 'user-123',
    relatedEntity: 'User',
    value: { status: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Preference;

  beforeEach(async () => {
    mockPreferenceRepository = {
      createPreference: jest.fn(),
      findPreference: jest.fn(),
      findPreferenceById: jest.fn(),
      updatePreference: jest.fn(),
      deletePreference: jest.fn(),
    };

    mockPreferenceCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceService,
        {
          provide: PreferenceRepository,
          useValue: mockPreferenceRepository,
        },
        { provide: RedisService, useValue: mockPreferenceCache },
      ],
    }).compile();

    service = module.get<PreferenceService>(PreferenceService);
  });

  describe('createPreference', () => {
    it('should create a new preference', async () => {
      const preferenceData = { name: PreferenceName.NUDGE_STATUS };
      mockPreferenceRepository.createPreference.mockResolvedValue(
        mockPreference,
      );

      const result = await service.createPreference(preferenceData);

      expect(mockPreferenceRepository.createPreference).toHaveBeenCalledWith(
        preferenceData,
      );
      expect(result).toEqual(mockPreference);
    });
  });

  describe('getPreference', () => {
    it('should return cached preference when found in cache', async () => {
      const name = PreferenceName.NUDGE_STATUS;
      const relatedId = 'user-123';
      const relatedEntity = 'User';
      const cacheKey = `preference:${name}:${relatedId}:${relatedEntity}`;
      const cachedData = JSON.stringify(mockPreference);
      mockPreferenceCache.get.mockResolvedValue(cachedData);

      const result = await service.getPreference(
        name,
        relatedId,
        relatedEntity,
      );

      expect(mockPreferenceCache.get).toHaveBeenCalledWith(cacheKey);
      expect(mockPreferenceRepository.findPreference).not.toHaveBeenCalled();
      expect(result).toEqual(JSON.parse(cachedData));
    });

    it('should return preference from database when not in cache', async () => {
      const name = PreferenceName.NUDGE_STATUS;
      const relatedId = 'user-123';
      const relatedEntity = 'User';
      const cacheKey = `preference:${name}:${relatedId}:${relatedEntity}`;
      mockPreferenceCache.get.mockResolvedValue(null);
      mockPreferenceRepository.findPreference.mockResolvedValue(mockPreference);

      const result = await service.getPreference(
        name,
        relatedId,
        relatedEntity,
      );

      expect(mockPreferenceCache.get).toHaveBeenCalledWith(cacheKey);
      expect(mockPreferenceRepository.findPreference).toHaveBeenCalledWith(
        name,
        relatedId,
        relatedEntity,
      );
      expect(mockPreferenceCache.set).toHaveBeenCalledWith(
        cacheKey,
        JSON.stringify(mockPreference),
      );
      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference not found in database', async () => {
      const name = PreferenceName.NUDGE_STATUS;
      const relatedId = 'user-123';
      const relatedEntity = 'User';
      mockPreferenceCache.get.mockResolvedValue(null);
      mockPreferenceRepository.findPreference.mockResolvedValue(null);

      const result = await service.getPreference(
        name,
        relatedId,
        relatedEntity,
      );

      expect(mockPreferenceRepository.findPreference).toHaveBeenCalledWith(
        name,
        relatedId,
        relatedEntity,
      );
      expect(mockPreferenceCache.set).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('updatePreference', () => {
    it('should update preference and cache when preference exists', async () => {
      const id = 'pref-123';
      const value = { status: false };
      const updatedPreference = { ...mockPreference, value };
      mockPreferenceRepository.updatePreference.mockResolvedValue(undefined);
      mockPreferenceRepository.findPreferenceById.mockResolvedValue(
        updatedPreference,
      );

      const result = await service.updatePreference(id, value);

      expect(mockPreferenceRepository.updatePreference).toHaveBeenCalledWith(
        id,
        value,
      );
      expect(mockPreferenceRepository.findPreferenceById).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceCache.set).toHaveBeenCalledWith(
        `preference:${updatedPreference.name}:${updatedPreference.relatedId}:${updatedPreference.relatedEntity}`,
        JSON.stringify(updatedPreference),
      );
      expect(result).toEqual(updatedPreference);
    });

    it('should return null when preference not found', async () => {
      const id = 'pref-123';
      const value = { status: false };
      mockPreferenceRepository.updatePreference.mockResolvedValue(undefined);
      mockPreferenceRepository.findPreferenceById.mockResolvedValue(null);

      const result = await service.updatePreference(id, value);

      expect(mockPreferenceRepository.updatePreference).toHaveBeenCalledWith(
        id,
        value,
      );
      expect(mockPreferenceRepository.findPreferenceById).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceCache.set).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('deletePreference', () => {
    it('should delete preference and cache successfully', async () => {
      const id = 'pref-123';
      mockPreferenceRepository.findPreferenceById.mockResolvedValue(
        mockPreference,
      );
      mockPreferenceRepository.deletePreference.mockResolvedValue(undefined);
      mockPreferenceCache.del.mockResolvedValue(1);

      const result = await service.deletePreference(id);

      expect(mockPreferenceRepository.findPreferenceById).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceRepository.deletePreference).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceCache.del).toHaveBeenCalledWith(
        `preference:${mockPreference.name}:${mockPreference.relatedId}:${mockPreference.relatedEntity}`,
      );
      expect(result).toEqual(mockPreference);
    });

    it('should return null when preference not found', async () => {
      const id = 'pref-123';
      mockPreferenceRepository.findPreferenceById.mockResolvedValue(null);

      const result = await service.deletePreference(id);

      expect(mockPreferenceRepository.findPreferenceById).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceRepository.deletePreference).not.toHaveBeenCalled();
      expect(mockPreferenceCache.del).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle cache deletion error gracefully', async () => {
      const id = 'pref-123';
      const cacheError = new Error('Cache error');
      mockPreferenceRepository.findPreferenceById.mockResolvedValue(
        mockPreference,
      );
      mockPreferenceRepository.deletePreference.mockResolvedValue(undefined);
      mockPreferenceCache.del.mockRejectedValue(cacheError);

      const result = await service.deletePreference(id);

      expect(mockPreferenceRepository.findPreferenceById).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceRepository.deletePreference).toHaveBeenCalledWith(
        id,
      );
      expect(mockPreferenceCache.del).toHaveBeenCalledWith(
        `preference:${mockPreference.name}:${mockPreference.relatedId}:${mockPreference.relatedEntity}`,
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Failed to delete cache entry:',
        cacheError,
      );
      expect(result).toEqual(mockPreference);
    });
  });
});
