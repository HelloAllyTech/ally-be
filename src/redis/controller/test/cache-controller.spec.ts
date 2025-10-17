import { Test, TestingModule } from '@nestjs/testing';
import { CacheController } from '../../controller/cache.controller';
import { RedisService } from '../../service/redis.service';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';

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
});
