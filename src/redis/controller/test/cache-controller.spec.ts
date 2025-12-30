import { Test, TestingModule } from '@nestjs/testing';
import { CacheController } from '../../controller/cache.controller';
import { RedisService } from '../../service/redis.service';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { UserService } from '../../../user/service/user.service';

describe('CacheController', () => {
  let controller: CacheController;
  let redisService: jest.Mocked<RedisService>;

  const mockRedisService: jest.Mocked<RedisService> = {
    getByPattern: jest.fn(),
    deleteByPattern: jest.fn(),
  } as any;

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  const mockUserService = {
    getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
  };

  const mockReflector = {
    get: jest.fn(),
    getAll: jest.fn(),
    getAllAndOverride: jest.fn(),
    getAllAndMerge: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: UserService, useValue: mockUserService },
        { provide: Reflector, useValue: mockReflector },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<CacheController>(CacheController);
    redisService = module.get(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getKeys', () => {
    it('returns keys when redisService succeeds', async () => {
      redisService.getByPattern.mockResolvedValueOnce(['k1', 'k2']);

      const result = await controller.getKeys({ pattern: 'user:*' } as any);

      expect(redisService.getByPattern).toHaveBeenCalledWith('user:*');
      expect(result).toEqual(['k1', 'k2']);
    });

    it('propagates error from redisService (catch block does not catch async errors)', async () => {
      redisService.getByPattern.mockRejectedValueOnce(new Error('boom'));

      await expect(
        controller.getKeys({ pattern: 'x:*' } as any),
      ).rejects.toThrow('boom');
      expect(redisService.getByPattern).toHaveBeenCalledWith('x:*');
    });

    it('passes the pattern from DTO to service', async () => {
      redisService.getByPattern.mockResolvedValueOnce(['only']);
      const dto = { pattern: 'orders:*' };
      const result = await controller.getKeys(dto as any);
      expect(redisService.getByPattern).toHaveBeenCalledWith('orders:*');
      expect(result).toEqual(['only']);
    });
  });

  describe('deleteKeys', () => {
    it('returns deleted keys when redisService succeeds', async () => {
      redisService.deleteByPattern.mockResolvedValueOnce(['user:1', 'user:2']);

      const result = await controller.deleteKeys({ pattern: 'user:*' } as any);

      expect(redisService.deleteByPattern).toHaveBeenCalledWith('user:*');
      expect(result).toEqual(['user:1', 'user:2']);
    });

    it('propagates error from redisService (catch block does not catch async errors)', async () => {
      redisService.deleteByPattern.mockRejectedValueOnce(new Error('nope'));

      await expect(
        controller.deleteKeys({ pattern: 'y:*' } as any),
      ).rejects.toThrow('nope');
      expect(redisService.deleteByPattern).toHaveBeenCalledWith('y:*');
    });

    it('passes the pattern from DTO to service', async () => {
      redisService.deleteByPattern.mockResolvedValueOnce(['invoices:1']);
      const dto = { pattern: 'invoices:*' };
      const result = await controller.deleteKeys(dto as any);
      expect(redisService.deleteByPattern).toHaveBeenCalledWith('invoices:*');
      expect(result).toEqual(['invoices:1']);
    });
  });

  describe('edge behavior (no validation pipe in unit test)', () => {
    it('getKeys calls service with undefined if pattern missing at call site', async () => {
      redisService.getByPattern.mockResolvedValueOnce([]);

      const result = await controller.getKeys({} as any);
      expect(redisService.getByPattern).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([]);
    });

    it('deleteKeys forwards undefined pattern if missing', async () => {
      redisService.deleteByPattern.mockResolvedValueOnce([]);

      const result = await controller.deleteKeys({} as any);
      expect(redisService.deleteByPattern).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should handle Redis connection errors in getKeys', async () => {
      const error = new Error('Redis connection failed');
      redisService.getByPattern.mockRejectedValueOnce(error);

      await expect(
        controller.getKeys({ pattern: 'test:*' } as any),
      ).rejects.toThrow('Redis connection failed');
    });

    it('should handle Redis connection errors in deleteKeys', async () => {
      const error = new Error('Redis connection failed');
      redisService.deleteByPattern.mockRejectedValueOnce(error);

      await expect(
        controller.deleteKeys({ pattern: 'test:*' } as any),
      ).rejects.toThrow('Redis connection failed');
    });

    it('should handle timeout errors in getKeys', async () => {
      const error = new Error('Redis timeout');
      redisService.getByPattern.mockRejectedValueOnce(error);

      await expect(
        controller.getKeys({ pattern: 'test:*' } as any),
      ).rejects.toThrow('Redis timeout');
    });

    it('should handle timeout errors in deleteKeys', async () => {
      const error = new Error('Redis timeout');
      redisService.deleteByPattern.mockRejectedValueOnce(error);

      await expect(
        controller.deleteKeys({ pattern: 'test:*' } as any),
      ).rejects.toThrow('Redis timeout');
    });
  });

  describe('pattern validation', () => {
    it('should handle wildcard patterns in getKeys', async () => {
      redisService.getByPattern.mockResolvedValueOnce(['key1', 'key2']);

      const result = await controller.getKeys({ pattern: '*:*' } as any);
      expect(redisService.getByPattern).toHaveBeenCalledWith('*:*');
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should handle specific patterns in deleteKeys', async () => {
      redisService.deleteByPattern.mockResolvedValueOnce([
        'deleted1',
        'deleted2',
      ]);

      const result = await controller.deleteKeys({
        pattern: 'user:123:*',
      } as any);
      expect(redisService.deleteByPattern).toHaveBeenCalledWith('user:123:*');
      expect(result).toEqual(['deleted1', 'deleted2']);
    });

    it('should handle empty pattern in getKeys', async () => {
      redisService.getByPattern.mockResolvedValueOnce([]);

      const result = await controller.getKeys({ pattern: '' } as any);
      expect(redisService.getByPattern).toHaveBeenCalledWith('');
      expect(result).toEqual([]);
    });

    it('should handle empty pattern in deleteKeys', async () => {
      redisService.deleteByPattern.mockResolvedValueOnce([]);

      const result = await controller.deleteKeys({ pattern: '' } as any);
      expect(redisService.deleteByPattern).toHaveBeenCalledWith('');
      expect(result).toEqual([]);
    });
  });

  describe('performance scenarios', () => {
    it('should handle large result sets in getKeys', async () => {
      const largeResultSet = Array.from({ length: 1000 }, (_, i) => `key${i}`);
      redisService.getByPattern.mockResolvedValueOnce(largeResultSet);

      const result = await controller.getKeys({ pattern: 'large:*' } as any);
      expect(result).toEqual(largeResultSet);
      expect(result).toHaveLength(1000);
    });

    it('should handle large deletion operations in deleteKeys', async () => {
      const largeDeletionSet = Array.from(
        { length: 500 },
        (_, i) => `deleted${i}`,
      );
      redisService.deleteByPattern.mockResolvedValueOnce(largeDeletionSet);

      const result = await controller.deleteKeys({ pattern: 'temp:*' } as any);
      expect(result).toEqual(largeDeletionSet);
      expect(result).toHaveLength(500);
    });
  });
});
