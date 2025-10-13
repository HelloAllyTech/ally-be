import { JwtStrategy } from '../jwt.strategy';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../../common/constants/user.constants';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  const mockConfigService: Partial<AppConfigService> = {
    jwt: {
      accessToken: {
        secret: 'access-secret',
        expiresIn: '1h',
      },
    } as any,
  };

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeAll(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger as any);
    jest
      .spyOn(ExecutionManager, 'setAuthContext')
      .mockImplementation(() => undefined as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    strategy = new JwtStrategy(mockConfigService as AppConfigService);
    jest.clearAllMocks();
  });

  it('constructs with config service without throwing', () => {
    expect(strategy).toBeDefined();
    // Verify the strategy name exists (PassportStrategy baseline)
    expect(typeof (strategy as any).name).toBe('string');
  });

  it('validate returns user and sets ExecutionManager context for non-super-admin with tenant', async () => {
    const payload = {
      sub: '101',
      username: 'alice',
      role: UserRole.COUNSELOR,
      tenantId: 'tenant-1',
    };

    const user = await strategy.validate(payload);

    expect(mockLogger.info).toHaveBeenCalledWith('JwtStrategy validate called');
    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '101',
      UserRole.COUNSELOR,
      'tenant-1',
    );
    expect(user).toEqual({
      id: 101,
      username: 'alice',
      role: UserRole.COUNSELOR,
      tenantId: 'tenant-1',
    });
  });

  it('validate allows SUPER_ADMIN without tenantId', async () => {
    const payload = {
      sub: '5',
      username: 'root',
      role: UserRole.SUPER_ADMIN,
      tenantId: undefined,
    };

    const user = await strategy.validate(payload);

    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '5',
      UserRole.SUPER_ADMIN,
      undefined,
    );
    expect(user).toEqual({
      id: 5,
      username: 'root',
      role: UserRole.SUPER_ADMIN,
      tenantId: undefined,
    });
  });

  it('validate throws UnauthorizedException when non-super-admin lacks tenantId', async () => {
    const payload = {
      sub: '7',
      username: 'bob',
      role: UserRole.CLIENT,
      tenantId: undefined,
    };

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '7',
      UserRole.CLIENT,
      undefined,
    );
  });
});
