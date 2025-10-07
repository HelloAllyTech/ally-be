import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContextMiddleware } from '../execution-context.middleware';
import { ExecutionManager } from '../execution-manager';

// Mock ExecutionManager
jest.mock('../execution-manager', () => ({
  ExecutionManager: {
    runWithContext: jest.fn(),
  },
}));

describe('ExecutionContextMiddleware', () => {
  let middleware: ExecutionContextMiddleware;
  let mockExecutionManager: any;

  beforeEach(async () => {
    mockExecutionManager = ExecutionManager as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecutionContextMiddleware],
    }).compile();

    middleware = module.get<ExecutionContextMiddleware>(
      ExecutionContextMiddleware,
    );
  });

  describe('use', () => {
    it('should run with execution context and call next', () => {
      const mockRequest = {
        path: '/test/path',
      } as any;
      const mockResponse = {} as any;
      const mockNext = jest.fn();

      // Mock runWithContext to actually call the function passed to it
      mockExecutionManager.runWithContext.mockImplementation(
        (fn: () => void) => {
          fn();
        },
      );

      middleware.use(mockRequest, mockResponse, mockNext);

      expect(mockExecutionManager.runWithContext).toHaveBeenCalledWith(
        expect.any(Function),
        mockRequest,
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
