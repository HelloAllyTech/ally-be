import { ExecutionManager } from '../../execution/execution-manager';
import {
  WithExecutionContext,
  ExecutionContextPropagation,
} from '../execution.context.decorator';

// Mock ExecutionManager
jest.mock('../../execution/execution-manager', () => ({
  ExecutionManager: {
    getCurrentContext: jest.fn(),
    runWithContext: jest.fn(),
  },
}));

describe('WithExecutionContext Decorator', () => {
  let mockExecutionManager: any;
  let mockOriginalMethod: jest.Mock;
  let mockDescriptor: PropertyDescriptor;
  let mockTarget: any;
  let mockPropertyKey: string;

  beforeEach(() => {
    mockExecutionManager = ExecutionManager as any;
    mockOriginalMethod = jest.fn();
    mockDescriptor = {
      value: mockOriginalMethod,
    };
    mockTarget = {
      constructor: {
        name: 'TestClass',
      },
    };
    mockPropertyKey = 'testMethod';

    jest.clearAllMocks();
  });

  describe('REQUIRED propagation', () => {
    it('should throw error when no context exists', async () => {
      mockExecutionManager.getCurrentContext.mockReturnValue(null);
      const decorator = WithExecutionContext(
        ExecutionContextPropagation.REQUIRED,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      await expect(mockDescriptor.value()).rejects.toThrow(
        'Execution context is required but not found',
      );
      expect(mockOriginalMethod).not.toHaveBeenCalled();
    });

    it('should execute method when context exists', async () => {
      const mockContext = { id: 'test-context' };
      const expectedResult = 'test-result';
      mockExecutionManager.getCurrentContext.mockReturnValue(mockContext);
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.REQUIRED,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });

  describe('REQUIRES_NEW propagation', () => {
    it('should create new context and execute method', async () => {
      const expectedResult = 'test-result';
      mockOriginalMethod.mockResolvedValue(expectedResult);
      mockExecutionManager.runWithContext.mockImplementation((fn: () => any) =>
        fn(),
      );

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.REQUIRES_NEW,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockExecutionManager.runWithContext).toHaveBeenCalledWith(
        expect.any(Function),
        { path: 'TestClass.testMethod' },
      );
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });

  describe('SUPPORTS propagation', () => {
    it('should execute method when context exists', async () => {
      const mockContext = { id: 'test-context' };
      const expectedResult = 'test-result';
      mockExecutionManager.getCurrentContext.mockReturnValue(mockContext);
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.SUPPORTS,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });

    it('should create new context when no context exists', async () => {
      const expectedResult = 'test-result';
      mockExecutionManager.getCurrentContext.mockReturnValue(null);
      mockOriginalMethod.mockResolvedValue(expectedResult);
      mockExecutionManager.runWithContext.mockImplementation((fn: () => any) =>
        fn(),
      );

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.SUPPORTS,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockExecutionManager.runWithContext).toHaveBeenCalledWith(
        expect.any(Function),
        { path: 'TestClass.testMethod' },
      );
      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });

  describe('NOT_SUPPORTED propagation', () => {
    it('should throw error when context exists', async () => {
      const mockContext = { id: 'test-context' };
      mockExecutionManager.getCurrentContext.mockReturnValue(mockContext);

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.NOT_SUPPORTED,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      await expect(mockDescriptor.value()).rejects.toThrow(
        'Execution context is not supported but found',
      );
      expect(mockOriginalMethod).not.toHaveBeenCalled();
    });

    it('should execute method when no context exists', async () => {
      const expectedResult = 'test-result';
      mockExecutionManager.getCurrentContext.mockReturnValue(null);
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = WithExecutionContext(
        ExecutionContextPropagation.NOT_SUPPORTED,
      );
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });

  describe('default case', () => {
    it('should execute method for unknown propagation type', async () => {
      const expectedResult = 'test-result';
      mockOriginalMethod.mockResolvedValue(expectedResult);

      const decorator = WithExecutionContext('UNKNOWN' as any);
      decorator(mockTarget, mockPropertyKey, mockDescriptor);

      const result = await mockDescriptor.value('arg1', 'arg2');

      expect(mockOriginalMethod).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBe(expectedResult);
    });
  });
});
