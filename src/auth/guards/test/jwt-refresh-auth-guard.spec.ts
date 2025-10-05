import { ExecutionContext } from '@nestjs/common';
import { JwtRefreshAuthGuard } from '../../guards/jwt-refresh-auth.guard';

// Mock the parent AuthGuard to capture delegation
const mockCanActivate = jest.fn();

jest.mock('@nestjs/passport', () => ({
  AuthGuard: jest.fn().mockImplementation(() => {
    return class MockAuthGuard {
      canActivate(context: any) {
        return mockCanActivate(context);
      }
    };
  }),
}));

describe('JwtRefreshAuthGuard', () => {
  let guard: JwtRefreshAuthGuard;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    guard = new JwtRefreshAuthGuard();
    mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
      }),
    } as any;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should delegate canActivate to parent AuthGuard (sync)', () => {
    mockCanActivate.mockReturnValue(true);

    const result = guard.canActivate(mockContext);

    expect(mockCanActivate).toHaveBeenCalledWith(mockContext);
    expect(result).toBe(true);
  });

  it('should delegate canActivate to parent AuthGuard (async)', async () => {
    mockCanActivate.mockResolvedValue(true);

    const result = await guard.canActivate(mockContext);

    expect(mockCanActivate).toHaveBeenCalledWith(mockContext);
    expect(result).toBe(true);
  });
});
