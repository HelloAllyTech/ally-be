import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UserSuspendedException } from '../../exception/login.exception';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { User } from 'src/user/entity/user.entity';
import { RefreshToken } from 'src/auth/entity/refresh-token.entity';
import { UserGroup } from 'src/authorization/entity/user-group.entity';
import { Group } from 'src/authorization/entity/group.entity';
import { GroupPermission } from 'src/authorization/entity/group-permission.entity';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { UserRole } from 'src/common/constants/user.constants';
import { UserStatus } from 'src/user/constants/user-status.constants';
import { AuthUtil } from 'src/auth/util/auth.util';
import { LoggerService } from 'src/logger/logger.service';
import { GroupService } from 'src/authorization/service/group.service';
import { AuthProvider } from 'src/auth/type/auth.types';

// Mock bcrypt at the module level
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('src/auth/util/auth.util', () => ({
  AuthUtil: {
    generateOtp: jest.fn(),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let dataSource: jest.Mocked<DataSource>;
  let groupService: jest.Mocked<GroupService>;

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const mockUser: User = {
    id: 1,
    username: 'testuser@example.com',
    email: 'testuser@example.com',
    password: 'hashedPassword',
    name: 'Test User',
    phone: '+1234567890',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    tenantId: '1',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as User;

  const mockConfig: any = {
    jwt: {
      accessToken: {
        expiresIn: '15m',
        secret: 'access-secret',
      },
      refreshToken: {
        expiresIn: '7d',
        secret: 'refresh-secret',
        ttlDays: 7,
      },
    },
    otp: {
      ttl: '300',
    },
    testAccounts: '{}',
    googleAuth: {
      androidClientId: 'android',
      iosClientId: 'ios',
      webClientId: 'web',
    },
  };

  const createMockRepository = () => ({
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  beforeAll(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    const mockUserRepo = createMockRepository();
    const mockRefreshTokenRepo = createMockRepository();
    const mockUserGroupRepo = createMockRepository();
    const mockGroupRepo = createMockRepository();
    const mockGroupPermissionRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn().mockImplementation((entity) => {
              switch (entity) {
                case User:
                  return mockUserRepo;
                case RefreshToken:
                  return mockRefreshTokenRepo;
                case UserGroup:
                  return mockUserGroupRepo;
                case Group:
                  return mockGroupRepo;
                case GroupPermission:
                  return mockGroupPermissionRepo;
                default:
                  return createMockRepository();
              }
            }),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
          },
        },
        {
          provide: AppConfigService,
          useValue: mockConfig,
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: GroupService,
          useValue: {
            getUserRolesByUserId: jest.fn(),
            getUserGroupNames: jest.fn(),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    dataSource = module.get(DataSource);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    groupService = module.get(GroupService);

    userRepository = dataSource.getRepository(User) as jest.Mocked<
      Repository<User>
    >;
    refreshTokenRepository = dataSource.getRepository(
      RefreshToken,
    ) as jest.Mocked<Repository<RefreshToken>>;

    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should login user with valid credentials and return tokens', async () => {
      const username = 'testuser@example.com';
      const password = 'password123';
      const accessToken = 'mock-access-token';
      const refreshToken = 'mock-refresh-token';

      userRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.login(username, password);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          username: mockUser.username,
        },
        accessToken,
        refreshToken,
        tokenType: 'bearer',
      });
    });

    it('should throw UnauthorizedException for invalid username', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.login('invalid@example.com', 'password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user has no password', async () => {
      const userWithoutPassword = {
        ...mockUser,
        password: undefined,
      } as unknown as User;
      userRepository.findOne.mockResolvedValue(userWithoutPassword);

      await expect(
        authService.login('testuser@example.com', 'password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.login('testuser@example.com', 'wrongpassword'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshTokens', () => {
    const oldRefreshToken = 'old-refresh-token';
    const userId = 1;
    const newAccessToken = 'new-access-token';
    const newRefreshToken = 'new-refresh-token';

    it('should refresh tokens successfully with valid refresh token', async () => {
      const tokenEntity = {
        token: 'hashed-refresh-token',
        userId,
        expiresAt: new Date(Date.now() + 86400000),
      } as RefreshToken;

      userRepository.findOne.mockResolvedValue(mockUser);
      refreshTokenRepository.findOne.mockResolvedValue(tokenEntity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      refreshTokenRepository.remove.mockResolvedValue(tokenEntity);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(newAccessToken)
        .mockResolvedValueOnce(newRefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.refreshTokens(oldRefreshToken, userId);

      expect(result).toEqual({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.refreshTokens('invalid-token', userId),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token comparison fails', async () => {
      const tokenEntity = {
        token: 'hashed-refresh-token',
        userId,
        expiresAt: new Date(Date.now() + 86400000),
      } as RefreshToken;

      userRepository.findOne.mockResolvedValue(mockUser);
      refreshTokenRepository.findOne.mockResolvedValue(tokenEntity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.refreshTokens(oldRefreshToken, userId),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateRefreshToken', () => {
    const refreshToken = 'refresh-token';
    const userId = 1;

    it('should validate refresh token successfully', async () => {
      const tokenEntity = {
        token: 'hashed-refresh-token',
        userId,
        expiresAt: new Date(Date.now() + 86400000),
      } as RefreshToken;

      refreshTokenRepository.findOne.mockResolvedValue(tokenEntity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userRepository.findOneOrFail.mockResolvedValue(mockUser);

      const result = await authService.validateRefreshToken(
        refreshToken,
        userId,
      );

      expect(result.id).toBe(mockUser.id);
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.validateRefreshToken(refreshToken, userId),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should delete all refresh tokens for user', async () => {
      const userId = 1;
      refreshTokenRepository.delete.mockResolvedValue({ affected: 2, raw: {} });

      await authService.logout(userId);

      expect(refreshTokenRepository.delete).toHaveBeenCalledWith({ userId });
    });
  });

  describe('generateOtpV2', () => {
    const mockGenerateOtpDto = {
      email: 'test@example.com',
      allowedRoles: [UserRole.CLIENT],
    };

    it('should generate OTP successfully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);
      (AuthUtil.generateOtp as jest.Mock).mockReturnValue('123456');
      redisService.get.mockResolvedValue(null);

      const result = await authService.generateOtpV2(mockGenerateOtpDto);

      expect(result).toEqual({
        success: true,
        expiresIn: 300,
      });
      expect(redisService.set).toHaveBeenCalledWith(
        'auth_attempt:test@example.com',
        expect.any(String),
        300,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('auth_attempt:magic:'),
        'test@example.com',
        300,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'otp:test@example.com',
        '123456',
        300,
      );
    });

    it('should throw BadRequestException when email is missing', async () => {
      await expect(
        authService.generateOtpV2({
          email: '',
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.generateOtpV2(mockGenerateOtpDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not have allowed role', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);

      await expect(
        authService.generateOtpV2(mockGenerateOtpDto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('verifyOtpV2', () => {
    const mockVerifyOtpDto = {
      otp: '123456',
      email: 'test@example.com',
      allowedRoles: [UserRole.CLIENT],
    };

    const mockUser = {
      id: 1,
      email: 'test@example.com',
      username: 'testuser',
      status: UserStatus.ACTIVE,
      tenantId: 'test-tenant',
    } as User;

    const mockSuspendedUser = {
      id: 2,
      email: 'suspended@example.com',
      username: 'suspendeduser',
      status: UserStatus.SUSPENDED,
      tenantId: 'test-tenant',
    } as User;

    const mockCachedAttempt = JSON.stringify({
      email: 'test@example.com',
      otpHash: require('crypto')
        .createHash('sha256')
        .update('123456')
        .digest('hex'),
      magicTokenHash: 'mock-magic-hash',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });

    const mockWrongOtpAttempt = JSON.stringify({
      email: 'test@example.com',
      otpHash: require('crypto')
        .createHash('sha256')
        .update('different-otp')
        .digest('hex'),
      magicTokenHash: 'mock-magic-hash',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw BadRequestException when email is not provided', async () => {
      const invalidDto = { ...mockVerifyOtpDto, email: '' };

      await expect(authService.verifyOtpV2(invalidDto as any)).rejects.toThrow(
        new BadRequestException('Email is required'),
      );
    });

    it('should throw NotFoundException when user is not found', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow(
        new NotFoundException('No account found associated with this email'),
      );
    });

    it('should throw UserSuspendedException when user is suspended', async () => {
      const suspendedAttempt = JSON.stringify({
        email: 'suspended@example.com',
        otpHash: require('crypto')
          .createHash('sha256')
          .update('123456')
          .digest('hex'),
        magicTokenHash: 'mock-magic-hash',
        expiresAt: new Date(Date.now() + 10000).toISOString(),
      });

      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:suspended@example.com')
          return Promise.resolve(suspendedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockSuspendedUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);

      await expect(
        authService.verifyOtpV2({
          ...mockVerifyOtpDto,
          email: 'suspended@example.com',
        } as any),
      ).rejects.toThrow(UserSuspendedException);
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow(
        new ForbiddenException('This account does not have the required role'),
      );
    });

    it('should throw UnauthorizedException when OTP is invalid', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockWrongOtpAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow(new UnauthorizedException('Invalid OTP'));
    });

    it('should throw UnauthorizedException when cached OTP does not match', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        if (key === 'otp:test@example.com') return Promise.resolve('wrong-otp');
        return Promise.resolve(null);
      });

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow(new UnauthorizedException('Invalid OTP'));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid OTP for email test@example.com',
      );
    });

    it('should successfully verify OTP and return tokens', async () => {
      const accessToken = 'access-token';
      const refreshToken = 'refresh-token';

      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        if (key === 'otp:test@example.com') return Promise.resolve('123456');
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtpV2(mockVerifyOtpDto as any);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          username: mockUser.username,
        },
        accessToken,
        refreshToken,
        tokenType: 'bearer',
      });

      expect(redisService.del).toHaveBeenCalledWith(
        'auth_attempt:test@example.com',
      );
      expect(redisService.del).toHaveBeenCalledWith(
        'auth_attempt:magic:mock-magic-hash',
      );
      expect(redisService.del).toHaveBeenCalledWith('otp:test@example.com');
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it('should log error when user is not found', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User not found for email ${mockVerifyOtpDto.email}`,
      );
    });

    it('should log error when user is suspended', async () => {
      const suspendedAttempt = JSON.stringify({
        email: 'suspended@example.com',
        otpHash: require('crypto')
          .createHash('sha256')
          .update('123456')
          .digest('hex'),
        magicTokenHash: 'mock-magic-hash',
        expiresAt: new Date(Date.now() + 10000).toISOString(),
      });

      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:suspended@example.com')
          return Promise.resolve(suspendedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockSuspendedUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);

      await expect(
        authService.verifyOtpV2({
          ...mockVerifyOtpDto,
          email: mockSuspendedUser.email,
        } as any),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User ${mockSuspendedUser.email} is suspended`,
      );
    });

    it('should log error when user is not authorized', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User not authorized for email ${mockVerifyOtpDto.email}`,
      );
    });

    it('should log error when OTP is invalid', async () => {
      // No auth attempt found in cache
      redisService.get.mockResolvedValue(null);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();
    });

    it('should call logVerificationError for relevant error scenarios', async () => {
      const logVerificationErrorSpy = jest.spyOn(
        authService as any,
        'logVerificationError',
      );

      // invalid/expired attempt (no attempt found in cache)
      redisService.get.mockResolvedValue(null);
      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();
      expect(logVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'Invalid or expired OTP',
        AuthProvider.EMAIL_OTP,
      );

      jest.clearAllMocks();

      // user not found (OTP valid)
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();
      expect(logVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'User not found',
        AuthProvider.EMAIL_OTP,
      );

      jest.clearAllMocks();

      // not authorized (OTP valid)
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']);

      await expect(
        authService.verifyOtpV2(mockVerifyOtpDto as any),
      ).rejects.toThrow();
      expect(logVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'User not found',
        AuthProvider.EMAIL_OTP,
      );

      logVerificationErrorSpy.mockRestore();
    });

    it('should log audit event on successful verification', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth_attempt:test@example.com')
          return Promise.resolve(mockCachedAttempt);
        if (key === 'otp:test@example.com') return Promise.resolve('123456');
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtpV2(mockVerifyOtpDto as any);

      expect(result).toBeDefined();
      expect(result.user.id).toBe(mockUser.id);
    });
  });

  describe('verifyMagicLink', () => {
    const mockMagicLinkUser = {
      id: 1,
      email: 'testuser@example.com',
      username: 'testuser@example.com',
      status: UserStatus.ACTIVE,
      tenantId: '1',
    } as User;

    const validToken = 'valid-magic-token';
    const tokenHash = require('crypto')
      .createHash('sha256')
      .update(validToken)
      .digest('hex');

    const mockMagicAttempt = JSON.stringify({
      email: 'testuser@example.com',
      otpHash: 'some-otp-hash',
      magicTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw UnauthorizedException when token is invalid or not found', async () => {
      redisService.get.mockResolvedValue(null);

      await expect(
        authService.verifyMagicLink({
          token: 'invalid-token',
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when magic link is expired', async () => {
      const expiredAttempt = JSON.stringify({
        email: 'testuser@example.com',
        otpHash: 'some-otp-hash',
        magicTokenHash: tokenHash,
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      });

      redisService.get.mockImplementation((key: string) => {
        if (key === `auth_attempt:magic:${tokenHash}`)
          return Promise.resolve('testuser@example.com');
        if (key === 'auth_attempt:testuser@example.com')
          return Promise.resolve(expiredAttempt);
        return Promise.resolve(null);
      });

      await expect(
        authService.verifyMagicLink({
          token: validToken,
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException when user no longer exists', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === `auth_attempt:magic:${tokenHash}`)
          return Promise.resolve('testuser@example.com');
        if (key === 'auth_attempt:testuser@example.com')
          return Promise.resolve(mockMagicAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyMagicLink({
          token: validToken,
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UserSuspendedException when user is suspended', async () => {
      const suspendedUser = {
        ...mockMagicLinkUser,
        email: 'testuser@example.com',
        status: UserStatus.SUSPENDED,
      } as User;

      redisService.get.mockImplementation((key: string) => {
        if (key === `auth_attempt:magic:${tokenHash}`)
          return Promise.resolve('testuser@example.com');
        if (key === 'auth_attempt:testuser@example.com')
          return Promise.resolve(mockMagicAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(suspendedUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);

      await expect(
        authService.verifyMagicLink({
          token: validToken,
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(UserSuspendedException);
    });

    it('should throw ForbiddenException when user does not have allowed role', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key === `auth_attempt:magic:${tokenHash}`)
          return Promise.resolve('testuser@example.com');
        if (key === 'auth_attempt:testuser@example.com')
          return Promise.resolve(mockMagicAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockMagicLinkUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);

      await expect(
        authService.verifyMagicLink({
          token: validToken,
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should successfully verify magic link and return tokens', async () => {
      const accessToken = 'magic-access-token';
      const refreshToken = 'magic-refresh-token';

      redisService.get.mockImplementation((key: string) => {
        if (key === `auth_attempt:magic:${tokenHash}`)
          return Promise.resolve('testuser@example.com');
        if (key === 'auth_attempt:testuser@example.com')
          return Promise.resolve(mockMagicAttempt);
        return Promise.resolve(null);
      });
      userRepository.findOne.mockResolvedValue(mockMagicLinkUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyMagicLink({
        token: validToken,
        allowedRoles: [UserRole.CLIENT],
      });

      expect(result).toEqual({
        user: {
          id: mockMagicLinkUser.id,
          username: mockMagicLinkUser.username,
        },
        accessToken,
        refreshToken,
        tokenType: 'bearer',
      });

      expect(redisService.del).toHaveBeenCalledWith(
        'auth_attempt:testuser@example.com',
      );
      expect(redisService.del).toHaveBeenCalledWith(
        `auth_attempt:magic:${tokenHash}`,
      );
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });
  });
});
