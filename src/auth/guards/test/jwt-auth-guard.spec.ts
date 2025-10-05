import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

// Mock the parent AuthGuard constructor to return a class with a canActivate method on prototype
const mockCanActivate = jest.fn();

jest.mock('@nestjs/passport', () => {
  return {
    AuthGuard: jest.fn().mockImplementation(() => {
      return class MockAuthGuard {
        canActivate(context: any) {
          return mockCanActivate(context);
        }
      };
    }),
  };
});

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    // Create a mock Reflector
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    // Instantiate the guard with the mock reflector
    guard = new JwtAuthGuard(mockReflector);

    // Create a minimal ExecutionContext mock
    mockContext = {
      getHandler: jest.fn().mockReturnValue({}),
      getClass: jest.fn().mockReturnValue({}),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
      }),
    } as any;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true if route is public (no delegation to parent)', () => {
    // Reflector indicates this route is public
    mockReflector.getAllAndOverride.mockReturnValue(true);

    const result = guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockCanActivate).not.toHaveBeenCalled();
  });

  it('should delegate to super.canActivate when route is not public (sync)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockCanActivate.mockReturnValue(true);

    const result = guard.canActivate(mockContext);

    expect(mockCanActivate).toHaveBeenCalledWith(mockContext);
    expect(result).toBe(true);
  });

  it('should delegate to super.canActivate when route is not public (async)', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockCanActivate.mockResolvedValue(true);

    const result = await guard.canActivate(mockContext);

    expect(mockCanActivate).toHaveBeenCalledWith(mockContext);
    expect(result).toBe(true);
  });
});
