import { CustomThrottlerGuard } from '../custom-throttler.guard';
import { ThrottlerLimitDetail } from '@nestjs/throttler';
import { RATE_LIMIT_KEY } from '../../constants/rate.limit.constants';
import { RateLimitOptions } from '../../decorator/rate-limit.decorator';
import { ExecutionContext } from '@nestjs/common';

describe('CustomThrottlerGuard', () => {
  let guard: CustomThrottlerGuard;
  let mockReflector: any;
  let mockStorageService: any;
  let mockOptions: any;

  const mockExecutionContext: ExecutionContext = {
    switchToHttp: jest.fn(() => ({
      getRequest: jest.fn(),
      getResponse: jest.fn(),
      getNext: jest.fn(),
    })),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as any;

  const mockRequest = {
    user: { id: 123 },
    ip: '192.168.1.1',
    ips: ['192.168.1.1', '10.0.0.1'],
    _context: undefined as any,
  };

  beforeEach(() => {
    mockReflector = { get: jest.fn() };
    mockStorageService = {
      getRecord: jest.fn(),
      setRecord: jest.fn(),
      deleteRecord: jest.fn(),
    };
    mockOptions = {
      throttlers: [
        {
          name: 'default',
          limit: 100,
          ttl: 1000,
        },
      ],
    };

    guard = new CustomThrottlerGuard(
      mockOptions,
      mockStorageService,
      mockReflector,
    );
  });

  describe('canActivate', () => {
    it('should store context in request and call parent canActivate', async () => {
      const mockReq = { ...mockRequest };
      const mockSwitchToHttp = jest.fn(() => ({
        getRequest: jest.fn().mockReturnValue(mockReq),
        getResponse: jest.fn(),
        getNext: jest.fn(),
      }));
      mockExecutionContext.switchToHttp = mockSwitchToHttp;

      // Temporarily replace parent canActivate
      const originalParent = Object.getPrototypeOf(
        CustomThrottlerGuard.prototype,
      ).canActivate;

      Object.getPrototypeOf(CustomThrottlerGuard.prototype).canActivate = jest
        .fn()
        .mockResolvedValue(true);

      const result = await guard.canActivate(mockExecutionContext);

      expect(mockReq._context).toBe(mockExecutionContext);
      expect(
        Object.getPrototypeOf(CustomThrottlerGuard.prototype).canActivate,
      ).toHaveBeenCalledWith(mockExecutionContext);
      expect(result).toBe(true);

      // Restore parent method
      Object.getPrototypeOf(CustomThrottlerGuard.prototype).canActivate =
        originalParent;
    });
  });

  describe('getTracker', () => {
    it('should return user-based tracker when key is userId', async () => {
      const rateLimitOptions: RateLimitOptions = { key: 'userId' };
      const req = { ...mockRequest, _context: mockExecutionContext };

      mockReflector.get.mockReturnValue(rateLimitOptions);
      mockExecutionContext.getHandler = jest.fn();

      const result = await (guard as any).getTracker(req);

      expect(mockReflector.get).toHaveBeenCalledWith(
        RATE_LIMIT_KEY,
        mockExecutionContext.getHandler(),
      );
      expect(result).toBe('user-123');
    });

    it('should return IP-based tracker when key is ip', async () => {
      const rateLimitOptions: RateLimitOptions = { key: 'ip' };
      const req = { ...mockRequest, _context: mockExecutionContext };

      mockReflector.get.mockReturnValue(rateLimitOptions);

      const result = await (guard as any).getTracker(req);
      expect(result).toBe('192.168.1.1');
    });

    it('should return first IP from ips array', async () => {
      const req = {
        ips: ['10.0.0.1', '192.168.1.1'],
        ip: '192.168.1.1',
        _context: mockExecutionContext,
      };

      mockReflector.get.mockReturnValue(null);

      const result = await (guard as any).getTracker(req);
      expect(result).toBe('10.0.0.1');
    });

    it('should return req.ip if no ips array', async () => {
      const req = { ip: '192.168.1.1', _context: mockExecutionContext };
      mockReflector.get.mockReturnValue(null);

      const result = await (guard as any).getTracker(req);
      expect(result).toBe('192.168.1.1');
    });

    it('should return unknown if no IP data', async () => {
      const req = { _context: mockExecutionContext };
      mockReflector.get.mockReturnValue(null);

      const result = await (guard as any).getTracker(req);
      expect(result).toBe('unknown');
    });
  });

  describe('getErrorMessage', () => {
    const throttlerLimitDetail: ThrottlerLimitDetail = {
      ttl: 1000,
      limit: 10,
      key: 'test',
      tracker: 'test-tracker',
      totalHits: 5,
      timeToExpire: 500,
      isBlocked: false,
      timeToBlockExpire: 0,
    };

    it('should return custom error message if provided', async () => {
      const customError: RateLimitOptions = {
        errorMessage: 'Custom rate limit exceeded',
      };
      mockReflector.get.mockReturnValue(customError);
      mockExecutionContext.getHandler = jest.fn();

      // Temporarily replace parent getErrorMessage
      const originalParent = Object.getPrototypeOf(
        CustomThrottlerGuard.prototype,
      ).getErrorMessage;
      Object.getPrototypeOf(CustomThrottlerGuard.prototype).getErrorMessage =
        jest.fn().mockResolvedValue('Default error');

      const result = await (guard as any).getErrorMessage(
        mockExecutionContext,
        throttlerLimitDetail,
      );

      expect(result).toBe('Custom rate limit exceeded');

      // Restore parent
      Object.getPrototypeOf(CustomThrottlerGuard.prototype).getErrorMessage =
        originalParent;
    });

    it('should return parent error message if no custom message', async () => {
      mockReflector.get.mockReturnValue(null);
      mockExecutionContext.getHandler = jest.fn();

      const originalParent = Object.getPrototypeOf(
        CustomThrottlerGuard.prototype,
      ).getErrorMessage;

      Object.getPrototypeOf(CustomThrottlerGuard.prototype).getErrorMessage =
        jest.fn().mockResolvedValue('Default rate limit exceeded');

      const result = await (guard as any).getErrorMessage(
        mockExecutionContext,
        throttlerLimitDetail,
      );

      expect(result).toBe('Default rate limit exceeded');

      Object.getPrototypeOf(CustomThrottlerGuard.prototype).getErrorMessage =
        originalParent;
    });
  });
});
