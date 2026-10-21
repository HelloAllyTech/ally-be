import { JwtStrategy } from '../jwt.strategy';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { UnauthorizedException } from '@nestjs/common';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LastActiveService } from '../../service/last-active.service';

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

  const mockLastActiveService: Partial<LastActiveService> = {
    touch: jest.fn().mockResolvedValue(undefined),
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
      mockLastActiveService as LastActiveService,
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
      tenantId: 'tenant-1',
    });
  });

  it('validate allows user with SYSTEM_ACCESS permission without tenantId', async () => {
    const payload = {
      sub: '5',
      username: 'root',
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
      tenantId: undefined,
    });
  });

  it('validate throws UnauthorizedException when user lacks SYSTEM_ACCESS permission and tenantId', async () => {
    const payload = {
      sub: '7',
      username: 'bob',
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

  describe('token kind', () => {
    it('rejects an AI Lab evaluator token before it becomes a session', async () => {
      // An evaluator's uuid `sub` must never be read as a platform user id.
      const payload = {
        sub: '3f2a6c1e-0000-4000-8000-000000000000',
        email: 'eval@x.com',
        kind: 'lab_evaluator',
        tv: 0,
      };
      (
        mockPermissionsService.getUserPermissions as jest.Mock
      ).mockResolvedValue([PERMISSIONS.SYSTEM_ACCESS]);

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(ExecutionManager.setAuthContext).not.toHaveBeenCalled();
      expect(mockLastActiveService.touch).not.toHaveBeenCalled();
      expect(mockPermissionsService.getUserPermissions).not.toHaveBeenCalled();
    });

    it.each([['some_future_kind'], [''], [null], [0]])(
      'rejects any kind platform auth does not issue (%p)',
      async (kind) => {
        await expect(
          strategy.validate({
            sub: '101',
            username: 'alice',
            tenantId: 'tenant-1',
            kind,
          }),
        ).rejects.toThrow(UnauthorizedException);
      },
    );

    it('accepts a platform token, which carries no kind claim', async () => {
      (
        mockPermissionsService.getUserPermissions as jest.Mock
      ).mockResolvedValue([]);

      await expect(
        strategy.validate({ sub: 101, username: 'alice', tenantId: 't-1' }),
      ).resolves.toEqual({ id: 101, username: 'alice', tenantId: 't-1' });
    });
  });
});
