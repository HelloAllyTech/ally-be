import { applyDecorators, UseGuards, SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RateLimit, RateLimitOptions } from '../rate-limit.decorator';
import { CustomThrottlerGuard } from '../../guard/custom-throttler.guard';
import { RATE_LIMIT_KEY } from '../../constants/rate.limit.constants';

// Mock the guard to avoid complex dependencies
jest.mock('../../guard/custom-throttler.guard', () => ({
  CustomThrottlerGuard: jest.fn(),
}));

// Mock the decorators
jest.mock('@nestjs/common', () => ({
  applyDecorators: jest.fn(),
  UseGuards: jest.fn(),
  SetMetadata: jest.fn(),
}));

jest.mock('@nestjs/throttler', () => ({
  Throttle: jest.fn(),
}));

describe('RateLimit Decorator', () => {
  let mockApplyDecorators: jest.Mock;
  let mockUseGuards: jest.Mock;
  let mockSetMetadata: jest.Mock;
  let mockThrottle: jest.Mock;

  beforeEach(() => {
    mockApplyDecorators = applyDecorators as jest.Mock;
    mockUseGuards = UseGuards as jest.Mock;
    mockSetMetadata = SetMetadata as jest.Mock;
    mockThrottle = Throttle as jest.Mock;

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('RateLimit', () => {
    it('should return decorators with only UseGuards when no options provided', () => {
      RateLimit();

      expect(mockUseGuards).toHaveBeenCalledWith(CustomThrottlerGuard);
      expect(mockSetMetadata).not.toHaveBeenCalled();
      expect(mockThrottle).not.toHaveBeenCalled();
      expect(mockApplyDecorators).toHaveBeenCalledWith(mockUseGuards());
    });

    it('should return decorators with UseGuards and SetMetadata when options provided without limit/ttl', () => {
      const options: RateLimitOptions = {
        key: 'userId',
        errorMessage: 'Custom error',
      };

      RateLimit(options);

      expect(mockUseGuards).toHaveBeenCalledWith(CustomThrottlerGuard);
      expect(mockSetMetadata).toHaveBeenCalledWith(RATE_LIMIT_KEY, options);
      expect(mockThrottle).not.toHaveBeenCalled();
      expect(mockApplyDecorators).toHaveBeenCalledWith(
        mockUseGuards(),
        mockSetMetadata(),
      );
    });

    it('should return decorators with UseGuards, SetMetadata, and Throttle when limit/ttl provided', () => {
      const options: RateLimitOptions = {
        key: 'ip',
        limit: 100,
        ttl: 1000,
        errorMessage: 'Rate limit exceeded',
      };

      RateLimit(options);

      expect(mockUseGuards).toHaveBeenCalledWith(CustomThrottlerGuard);
      expect(mockSetMetadata).toHaveBeenCalledWith(RATE_LIMIT_KEY, options);
      expect(mockThrottle).toHaveBeenCalledWith({
        default: {
          limit: 100,
          ttl: 1000,
        },
      });
      expect(mockApplyDecorators).toHaveBeenCalledWith(
        mockUseGuards(),
        mockSetMetadata(),
        mockThrottle(),
      );
    });
  });
});
