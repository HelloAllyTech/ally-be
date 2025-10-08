import { JwtStrategy } from '../jwt.strategy';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../../common/constants/user.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

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

  const mockPermissionsService: Partial<PermissionsService> = {
    getUserPermissions: jest.fn().mockResolvedValue([]),
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
    strategy = new JwtStrategy(
      mockConfigService as AppConfigService,
      mockPermissionsService as PermissionsService,
    );
    jest.clearAllMocks();
  });

  it('constructs with config service without throwing', () => {
    expect(strategy).toBeDefined();
    // Verify the strategy name exists (PassportStrategy baseline)
    expect(typeof (strategy as any).name).toBe('string');
  });

  it('validate returns user and sets ExecutionManager context for user with tenant', async () => {
    const payload = {
      sub: '101',
      username: 'alice',
      role: UserRole.COUNSELOR,
      tenantId: 'tenant-1',
    };

    // Mock the permissions service to return empty permissions (no SYSTEM_ACCESS)
    (mockPermissionsService.getUserPermissions as jest.Mock).mockResolvedValue(
      [],
    );

    const user = await strategy.validate(payload);

    expect(mockLogger.info).toHaveBeenCalledWith('JwtStrategy validate called');
    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '101',
      'tenant-1',
    );
    expect(user).toEqual({
      id: 101,
      username: 'alice',
      role: UserRole.COUNSELOR,
      tenantId: 'tenant-1',
    });
  });

  it('validate allows user with SYSTEM_ACCESS permission without tenantId', async () => {
    const payload = {
      sub: '5',
      username: 'root',
      role: UserRole.SUPER_ADMIN,
      tenantId: undefined,
    };

    // Mock the permissions service to return SYSTEM_ACCESS permission
    (mockPermissionsService.getUserPermissions as jest.Mock).mockResolvedValue([
      PERMISSIONS.SYSTEM_ACCESS,
    ]);

    const user = await strategy.validate(payload);

    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '5',
      undefined,
    );
    expect(user).toEqual({
      id: 5,
      username: 'root',
      role: UserRole.SUPER_ADMIN,
      tenantId: undefined,
    });
  });

  it('validate throws UnauthorizedException when user lacks SYSTEM_ACCESS permission and tenantId', async () => {
    const payload = {
      sub: '7',
      username: 'bob',
      role: UserRole.CLIENT,
      tenantId: undefined,
    };

    // Mock the permissions service to return empty permissions (no SYSTEM_ACCESS)
    (mockPermissionsService.getUserPermissions as jest.Mock).mockResolvedValue(
      [],
    );

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(ExecutionManager.setAuthContext).toHaveBeenCalledWith(
      '7',
      undefined,
    );
  });
});
