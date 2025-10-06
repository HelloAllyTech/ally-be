import { CustomThrottlerGuard } from 'src/rate-limit/guard/custom-throttler.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from 'src/auth/guards/jwt-refresh-auth.guard';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from 'src/auth/service/auth.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';

const mockAuthService = {
  login: jest.fn(),
  generateOtp: jest.fn(),
  verifyOtp: jest.fn(),
  signup: jest.fn(),
  refreshTokens: jest.fn(),
  logout: jest.fn(),
  getUserPermissions: jest.fn(),
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

  it('should generate OTP', async () => {
    mockAuthService.generateOtp.mockResolvedValue({ otp: '1234' });
    const result = await controller.generateOtp({
      phone: '123',
      email: 'a@b.com',
    });
    expect(result).toEqual({ otp: '1234' });
  });

  it('should verify OTP', async () => {
    mockAuthService.verifyOtp.mockResolvedValue({ verified: true });
    const result = await controller.verifyOtp({
      otp: '1234',
      phone: '123',
      email: 'a@b.com',
    });
    expect(result).toEqual({ verified: true });
  });

  it('should signup successfully', async () => {
    mockAuthService.signup.mockResolvedValue({ id: 1, username: 'test' });
    const result = await controller.signup({
      username: 'test',
      password: 'pass',
      email: '',
      name: '',
      roles: [],
      tenantId: '',
    });
    expect(result).toEqual({
      message: 'User created successfully',
      user: { id: 1, username: 'test' },
    });
  });

  it('should throw BadRequestException if signup fails', async () => {
    mockAuthService.signup.mockRejectedValue(new Error('Fail'));
    await expect(
      controller.signup({
        username: 'test',
        password: 'pass',
        email: '',
        name: '',
        roles: [],
        tenantId: '',
      }),
    ).rejects.toThrow(BadRequestException);
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

  it('should get user permissions', async () => {
    mockPermissionsService.getUserPermissions.mockResolvedValue([
      'read',
      'write',
    ]);
    const req = { user: { id: '1' } };
    const result = await controller.getPermissions(req as any);
    expect(result).toEqual(['read', 'write']);
  });
});
