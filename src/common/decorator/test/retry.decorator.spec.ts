import { RetryOnFail } from '../retry.decorator';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      warn: jest.fn(),
    })),
  },
}));

describe('RetryOnFail Decorator', () => {
  let mockOriginalMethod: jest.Mock;
  let mockDescriptor: PropertyDescriptor;
  let mockTarget: any;
  let mockPropertyKey: string;

  beforeEach(() => {
    mockOriginalMethod = jest.fn();
    mockDescriptor = {
      value: mockOriginalMethod,
    };
    mockTarget = {};
    mockPropertyKey = 'testMethod';

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('success scenarios', () => {
    it('should execute method successfully on first attempt', async () => {
      const expectedResult = 'test-result';
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = RetryOnFail(3, 1000);
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledTimes(1);
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });

    it('should use default parameters when not provided', async () => {
      const expectedResult = 'test-result';
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = RetryOnFail(); // Use default parameters
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledTimes(1);
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });

    it('should retry and succeed after failures', async () => {
      const expectedResult = 'test-result';
      const mockError = new Error('Test error');
      mockOriginalMethod
        .mockRejectedValueOnce(mockError)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValue(expectedResult);

      const decorator = RetryOnFail(3, 1000);
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const resultPromise = mockDescriptor.value('arg1', 'arg2');

      // Fast-forward through the delays
      await jest.advanceTimersByTimeAsync(1000); // First retry delay
      await jest.advanceTimersByTimeAsync(2000); // Second retry delay

      const result = await resultPromise;

      expect(mockOriginalMethod).toHaveBeenCalledTimes(3);
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });

  describe('failure scenarios', () => {
    it('should fail after all retry attempts', async () => {
      // Use real timers for this test to avoid Jest conflicts
      jest.useRealTimers();

      const mockError = new Error('API error');
      mockOriginalMethod.mockRejectedValue(mockError);

      const decorator = RetryOnFail(2, 100); // Use shorter delay for faster test
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      // Start the async operation
      const resultPromise = mockDescriptor.value('arg1', 'arg2');

      // Wait for the promise to reject
      await expect(resultPromise).rejects.toThrow('API error');

      expect(mockOriginalMethod).toHaveBeenCalledTimes(2);
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');

      // Restore fake timers
      jest.useFakeTimers();
    });
  });
});
