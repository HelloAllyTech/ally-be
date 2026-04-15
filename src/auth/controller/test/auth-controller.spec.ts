import { CustomThrottlerGuard } from 'src/rate-limit/guard/custom-throttler.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from 'src/auth/guards/jwt-refresh-auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from 'src/auth/service/auth.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { AppType, UserRole } from 'src/common/constants/user.constants';

const mockAuthService = {
  login: jest.fn(),
  generateOtpV2: jest.fn(),
  verifyOtpV2: jest.fn(),
  refreshTokens: jest.fn(),
  logout: jest.fn(),
  getUserPermissions: jest.fn(),
  impersonate: jest.fn(),
};

const mockPermissionsService = {
  getUserPermissions: jest.fn(),
  hasPermission: jest.fn(),
  checkPermission: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: PermissionsService, useValue: mockPermissionsService },
      ],
    })
      // Mock all guards
      .overrideGuard(CustomThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(JwtRefreshAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should login successfully', async () => {
    mockAuthService.login.mockResolvedValue({ accessToken: 'token' });
    const result = await controller.login({
      username: 'user',
      password: 'pass',
    });
    expect(result).toEqual({ accessToken: 'token' });
  });

  it('should refresh tokens successfully', async () => {
    mockAuthService.refreshTokens.mockResolvedValue({
      accessToken: 'newToken',
      refreshToken: 'refToken',
    });
    const req = { user: { id: 1, refreshToken: 'oldToken' } };
    const result = await controller.refreshTokens(req as any);
    expect(result).toEqual({
      accessToken: 'newToken',
      refreshToken: 'refToken',
      tokenType: 'bearer',
    });
  });

  it('should throw UnauthorizedException if refresh token is invalid', async () => {
    mockAuthService.refreshTokens.mockResolvedValue(null);
    const req = { user: { id: 1, refreshToken: 'badToken' } };
    await expect(controller.refreshTokens(req as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should logout successfully', async () => {
    const req = { user: { id: '1' } };
    mockAuthService.logout.mockResolvedValue(undefined);
    const result = await controller.logout(req as any);
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  // V2 OTP tests
  it('should generate OTP V2 successfully', async () => {
    mockAuthService.generateOtpV2.mockResolvedValue({ success: true });
    const result = await controller.generateOtpV2({
      email: 'test@example.com',
      allowedRoles: [UserRole.CLIENT],
      appType: AppType.APP,
    });
    expect(result).toEqual({ success: true });
  });

  it('should verify OTP V2 successfully', async () => {
    mockAuthService.verifyOtpV2.mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      user: { id: 1, email: 'test@example.com' },
    });
    const result = await controller.verifyOtpV2({
      otp: '123456',
      email: 'test@example.com',
      allowedRoles: [UserRole.CLIENT],
    });
    expect(result).toEqual({
      accessToken: 'token',
      refreshToken: 'refresh',
      user: { id: 1, email: 'test@example.com' },
    });
  });

  describe('impersonate', () => {
    it('should call impersonate method and return tokens', async () => {
      mockAuthService.impersonate.mockResolvedValue({
        message: 'Impersonation successful',
        data: { accessToken: 'token', refreshToken: 'refresh' },
      });
      const result = await controller.impersonate({
        email: 'test@example.com',
      } as any);
      expect(result).toEqual({
        message: 'Impersonation successful',
        data: { accessToken: 'token', refreshToken: 'refresh' },
      });
      expect(mockAuthService.impersonate).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
    });
  });
});
