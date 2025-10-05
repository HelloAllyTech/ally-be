import { RedisService as NestRedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { RedisService } from '../redis.service';

jest.mock('@liaoliaots/nestjs-redis');
jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;
  let mockNestRedisService: jest.Mocked<NestRedisService>;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      duplicate: jest.fn(),
      scanStream: jest.fn(),
      hincrby: jest.fn(),
      hgetall: jest.fn(),
    } as any;

    mockNestRedisService = {
      getOrThrow: jest.fn().mockReturnValue(mockRedis),
    } as any;

    process.env.REDIS_PREFIX = 'testprefix';

    service = new RedisService(mockNestRedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with prefix from env', () => {
      expect((service as any).prefix).toBe('testprefix');
    });

    it('should fallback to default prefix when env not set', () => {
      delete process.env.REDIS_PREFIX;
      const s = new RedisService(mockNestRedisService);
      expect((s as any).prefix).toBe('ally');
    });
  });

  describe('createClient', () => {
    it('should create a new client by duplicating base', () => {
      const dup = { name: 'client1' } as any;
      mockRedis.duplicate.mockReturnValue(dup);
      const client = service.createClient('client1');
      expect(mockNestRedisService.getOrThrow).toHaveBeenCalled();
      expect(mockRedis.duplicate).toHaveBeenCalledWith({ name: 'client1' });
      expect(client).toBe(dup);
    });
  });

  describe('set', () => {
    it('should set without ttl', async () => {
      await service.set('key', 'value');
      expect(mockRedis.set).toHaveBeenCalledWith('testprefix:key', 'value');
    });

    it('should set with ttl', async () => {
      await service.set('key', 'value', 60);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'testprefix:key',
        'value',
        'EX',
        60,
      );
    });
  });

  describe('get', () => {
    it('should get value from redis', async () => {
      mockRedis.get.mockResolvedValue('val');
      const result = await service.get('key');
      expect(mockRedis.get).toHaveBeenCalledWith('testprefix:key');
      expect(result).toBe('val');
    });
  });

  describe('del', () => {
    it('should delete key from redis', async () => {
      await service.del('key');
      expect(mockRedis.del).toHaveBeenCalledWith('testprefix:key');
    });
  });

  describe('getFullKey', () => {
    it('should return key with prefix', () => {
      const key = (service as any).getFullKey('abc');
      expect(key).toBe('testprefix:abc');
    });
  });

  describe('getByPattern', () => {
    it('should resolve keys on stream end', async () => {
      const onHandlers: Record<string, (...args: any[]) => void> = {};
      mockRedis.scanStream.mockReturnValue({
        on: (event: string, cb: (...args: any[]) => void) => {
          onHandlers[event] = cb;
          return this;
        },
      } as any);

      const promise = service.getByPattern('pattern');

      onHandlers['data'](['key1', 'key2']);
      onHandlers['end']();

      const result = await promise;
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should reject on stream error', async () => {
      const onHandlers: Record<string, (...args: any[]) => void> = {};
      mockRedis.scanStream.mockReturnValue({
        on: (event: string, cb: (...args: any[]) => void) => {
          onHandlers[event] = cb;
          return this;
        },
      } as any);

      const promise = service.getByPattern('pattern');
      onHandlers['error'](new Error('scan failed'));

      await expect(promise).rejects.toThrow('scan failed');
    });
  });

  describe('deleteByPattern', () => {
    it('should delete keys if found', async () => {
      jest.spyOn(service, 'getByPattern').mockResolvedValue(['key1', 'key2']);
      await service.deleteByPattern('patt');
      expect(mockRedis.del).toHaveBeenCalledWith(['key1', 'key2']);
    });

    it('should not delete if no keys', async () => {
      jest.spyOn(service, 'getByPattern').mockResolvedValue([]);
      await service.deleteByPattern('patt');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('hincrBy', () => {
    it('should increment field in hash', async () => {
      mockRedis.hincrby.mockResolvedValue(5);
      const result = await service.hincrBy('hkey', 'field', 2);
      expect(mockRedis.hincrby).toHaveBeenCalledWith(
        'testprefix:hkey',
        'field',
        2,
      );
      expect(result).toBe(5);
    });
  });

  describe('hgetAll', () => {
    it('should return all fields', async () => {
      mockRedis.hgetall.mockResolvedValue({ a: '1', b: '2' });
      const result = await service.hgetAll('hkey');
      expect(mockRedis.hgetall).toHaveBeenCalledWith('testprefix:hkey');
      expect(result).toEqual({ a: '1', b: '2' });
    });
  });
});
