import { ExecutionManager } from '../execution-manager';

// Mock crypto module
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-123'),
}));

describe('ExecutionManager', () => {
  beforeEach(() => {
    // Clear any existing context before each test
    jest.clearAllMocks();
  });

  describe('runWithContext', () => {
    it('should run function with execution context', () => {
      const mockFn = jest.fn(() => 'test-result');
      const path = '/test/path';

      const result = ExecutionManager.runWithContext(mockFn, { path });

      expect(mockFn).toHaveBeenCalled();
      expect(result).toBe('test-result');
    });
  });

  describe('setAuthContext', () => {
    it('should set auth context when context exists', () => {
      const userId = 'user-123';
      const role = 'admin';
      const tenantId = 'tenant-456';
      const path = '/test/path';

      // First run with context to create a store
      ExecutionManager.runWithContext(
        () => {
          ExecutionManager.setAuthContext(userId, role, tenantId);

          expect(ExecutionManager.getUserId()).toBe(userId);
          expect(ExecutionManager.getRole()).toBe(role);
          expect(ExecutionManager.getTenantId()).toBe(tenantId);
        },
        { path },
      );
    });

    it('should not set auth context when no context exists', () => {
      const userId = 'user-123';
      const role = 'admin';
      const tenantId = 'tenant-456';

      // Call setAuthContext without any existing context
      ExecutionManager.setAuthContext(userId, role, tenantId);

      // Should not throw error and context should remain undefined
      expect(ExecutionManager.getUserId()).toBeUndefined();
      expect(ExecutionManager.getRole()).toBeUndefined();
      expect(ExecutionManager.getTenantId()).toBeUndefined();
    });
  });

  describe('getCurrentContext', () => {
    it('should return current execution context', () => {
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          const context = ExecutionManager.getCurrentContext();

          expect(context).toBeDefined();
          expect(context?.id).toBe('mock-uuid-123');
          expect(context?.path).toBe(path);
          expect(context?.startTime).toBeDefined();
        },
        { path },
      );
    });

    it('should return undefined when no context exists', () => {
      const context = ExecutionManager.getCurrentContext();
      expect(context).toBeUndefined();
    });
  });

  describe('getUserId', () => {
    it('should return user ID from context', () => {
      const userId = 'user-123';
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          ExecutionManager.setAuthContext(userId, 'admin', 'tenant-456');
          expect(ExecutionManager.getUserId()).toBe(userId);
        },
        { path },
      );
    });

    it('should return undefined when no context or user ID', () => {
      expect(ExecutionManager.getUserId()).toBeUndefined();
    });
  });

  describe('getRole', () => {
    it('should return role from context', () => {
      const role = 'admin';
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          ExecutionManager.setAuthContext('user-123', role, 'tenant-456');
          expect(ExecutionManager.getRole()).toBe(role);
        },
        { path },
      );
    });

    it('should return undefined when no context or role', () => {
      expect(ExecutionManager.getRole()).toBeUndefined();
    });
  });

  describe('getTenantId', () => {
    it('should return tenant ID from context', () => {
      const tenantId = 'tenant-456';
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          ExecutionManager.setAuthContext('user-123', 'admin', tenantId);
          expect(ExecutionManager.getTenantId()).toBe(tenantId);
        },
        { path },
      );
    });

    it('should return undefined when no context or tenant ID', () => {
      expect(ExecutionManager.getTenantId()).toBeUndefined();
    });
  });

  describe('getPath', () => {
    it('should return path from context', () => {
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          expect(ExecutionManager.getPath()).toBe(path);
        },
        { path },
      );
    });

    it('should return undefined when no context', () => {
      expect(ExecutionManager.getPath()).toBeUndefined();
    });
  });

  describe('getExecutionId', () => {
    it('should return execution ID from context', () => {
      const path = '/test/path';

      ExecutionManager.runWithContext(
        () => {
          expect(ExecutionManager.getExecutionId()).toBe('mock-uuid-123');
        },
        { path },
      );
    });

    it('should return undefined when no context', () => {
      expect(ExecutionManager.getExecutionId()).toBeUndefined();
    });
  });
});
