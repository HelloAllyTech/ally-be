import { RedisService } from '../redis.service';
import { AppConfigService } from '../../../config/config.service';

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  duplicate: jest.fn(),
  scanStream: jest.fn(),
  hincrby: jest.fn(),
  hgetall: jest.fn(),
};

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => mockRedis);
  return { default: MockRedis, __esModule: true };
});

const createMockAppConfigService = (
  overrides?: Partial<{
    prefix: string;
    host: string;
    port: number;
  }>,
) => ({
  redis: {
    prefix: 'testprefix',
    host: 'localhost',
    port: 6379,
    ...overrides,
  },
});

describe('RedisService', () => {
  let service: RedisService;
  let mockAppConfigService: jest.Mocked<Pick<AppConfigService, 'redis'>>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppConfigService = createMockAppConfigService() as any;
    service = new RedisService(mockAppConfigService as AppConfigService);
  });

  describe('constructor', () => {
    it('should initialize with prefix from config', () => {
      expect((service as any).prefix).toBe('testprefix');
    });

    it('should use default prefix when config returns ally', () => {
      const configWithDefaultPrefix = createMockAppConfigService({
        prefix: 'ally',
      }) as any;
      const s = new RedisService(configWithDefaultPrefix as AppConfigService);
      expect((s as any).prefix).toBe('ally');
    });
  });

  describe('createClient', () => {
    it('should create a new client by duplicating base', () => {
      const dup = { name: 'client1' } as any;
      mockRedis.duplicate.mockReturnValue(dup);
      const client = service.createClient('client1');
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
      const mockStream = {
        on: (event: string, cb: (...args: any[]) => void) => {
          onHandlers[event] = cb;
          return mockStream;
        },
      } as any;
      mockRedis.scanStream.mockReturnValue(mockStream);

      const promise = service.getByPattern('pattern');

      expect(mockRedis.scanStream).toHaveBeenCalledWith({ match: 'pattern' });
      onHandlers['data'](['key1', 'key2']);
      onHandlers['end']();

      const result = await promise;
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should reject on stream error', async () => {
      const onHandlers: Record<string, (...args: any[]) => void> = {};
      const mockStream = {
        on: (event: string, cb: (...args: any[]) => void) => {
          onHandlers[event] = cb;
          return mockStream;
        },
      } as any;
      mockRedis.scanStream.mockReturnValue(mockStream);

      const promise = service.getByPattern('pattern');
      expect(mockRedis.scanStream).toHaveBeenCalledWith({ match: 'pattern' });
      onHandlers['error'](new Error('scan failed'));

      await expect(promise).rejects.toThrow('scan failed');
    });
  });

  describe('deleteByPattern', () => {
    it('should delete keys if found and return keys', async () => {
      jest.spyOn(service, 'getByPattern').mockResolvedValue(['key1', 'key2']);
      const result = await service.deleteByPattern('patt');
      expect(mockRedis.del).toHaveBeenCalledWith(['key1', 'key2']);
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should not delete if no keys and return empty array', async () => {
      jest.spyOn(service, 'getByPattern').mockResolvedValue([]);
      const result = await service.deleteByPattern('patt');
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(result).toEqual([]);
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
