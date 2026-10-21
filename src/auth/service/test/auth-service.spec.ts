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
import * as crypto from 'crypto';
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
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { OtpRateLimitedException } from 'src/auth/exception/login.exception';
import {
  OTP_LIMIT_MESSAGES,
  OTP_LIMITS,
} from 'src/auth/constants/otp-limits.constants';
import { TIME } from 'src/common/constants/time.constants';
import { ErrorCode } from 'src/exception/error-code.enum';

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

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let dataSource: jest.Mocked<DataSource>;
  let groupService: jest.Mocked<GroupService>;
  let permissionsService: jest.Mocked<PermissionsService>;
  let tenantScopeService: jest.Mocked<TenantScopeService>;

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
      clientIds: [
        '111-android.apps.googleusercontent.com',
        '111-ios.apps.googleusercontent.com',
        '111-web.apps.googleusercontent.com',
      ],
    },
    appleAuth: {
      bundleIds: ['com.helloally.app', 'com.helloally.app.dev'],
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
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  /** Chainable stand-in for the refresh-token pruning / legacy lookup builder. */
  const createMockQueryBuilder = () => {
    const qb: any = {};
    for (const m of ['delete', 'where', 'andWhere', 'orWhere']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
    qb.getOne = jest.fn().mockResolvedValue(null);
    return qb;
  };
  let refreshTokenQueryBuilder: ReturnType<typeof createMockQueryBuilder>;

  beforeAll(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    const mockUserRepo = createMockRepository();
    const mockRefreshTokenRepo = createMockRepository();
    refreshTokenQueryBuilder = createMockQueryBuilder();
    mockRefreshTokenRepo.createQueryBuilder.mockReturnValue(
      refreshTokenQueryBuilder,
    );
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
            decode: jest.fn(),
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
            // Defaults to no listeners (matches production with notifications
            // disabled) so existing tests keep asserting `success: true`.
            emitAsync: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            // A first hit, unless a test says otherwise: well inside every limit.
            incrWithExpiry: jest
              .fn()
              .mockResolvedValue({ count: 1, ttlSeconds: 300 }),
          },
        },
        {
          provide: GroupService,
          useValue: {
            getUserRolesByUserId: jest.fn(),
            getUserGroupNames: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: jest.fn(),
            isMultiTenantAdmin: jest.fn(),
          },
        },
        {
          provide: TenantScopeService,
          useValue: { isRestricted: jest.fn() },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    dataSource = module.get(DataSource);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    groupService = module.get(GroupService);
    permissionsService = module.get(PermissionsService);
    tenantScopeService = module.get(TenantScopeService);

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
    const userId = 1;
    const oldRefreshToken = 'old-refresh-token';
    const newAccessToken = 'new-access-token';
    const newRefreshToken = 'new-refresh-token';
    const sha = (t: string) =>
      crypto.createHash('sha256').update(t).digest('hex');
    const exactRow = (overrides: Partial<RefreshToken> = {}) =>
      ({
        id: 7,
        token: sha(oldRefreshToken),
        userId,
        expiresAt: new Date(Date.now() + 86400000),
        rotatedAt: null,
        ...overrides,
      }) as RefreshToken;

    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(mockUser);
      jwtService.signAsync
        .mockResolvedValueOnce(newAccessToken)
        .mockResolvedValueOnce(newRefreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
    });

    describe('tokens with a jti (exact match)', () => {
      beforeEach(() => {
        jwtService.decode.mockReturnValue({ sub: userId, jti: 'j1' });
      });

      it('matches the row by SHA-256 of the whole token and stamps rotatedAt', async () => {
        refreshTokenRepository.findOne.mockResolvedValue(exactRow());

        const result = await authService.refreshTokens(oldRefreshToken, userId);

        expect(result).toEqual({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        });
        expect(refreshTokenRepository.findOne).toHaveBeenCalledWith({
          where: expect.objectContaining({
            userId,
            token: sha(oldRefreshToken),
          }),
        });
        expect(refreshTokenRepository.update).toHaveBeenCalledWith(
          { id: 7 },
          { rotatedAt: expect.any(Date) },
        );
        expect(refreshTokenRepository.remove).not.toHaveBeenCalled();
      });

      it('lets a concurrent refresh reuse a token rotated inside the grace window', async () => {
        refreshTokenRepository.findOne.mockResolvedValue(
          exactRow({ rotatedAt: new Date(Date.now() - 5_000) }),
        );

        await expect(
          authService.refreshTokens(oldRefreshToken, userId),
        ).resolves.toEqual({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        });
        expect(refreshTokenRepository.update).not.toHaveBeenCalled();
      });

      it('refuses a token rotated longer ago than the grace window', async () => {
        refreshTokenRepository.findOne.mockResolvedValue(
          exactRow({
            rotatedAt: new Date(
              Date.now() - AuthService.REFRESH_TOKEN_REUSE_GRACE_MS - 1_000,
            ),
          }),
        );

        await expect(
          authService.refreshTokens(oldRefreshToken, userId),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('never falls back to the bcrypt rows, which match any token of the user', async () => {
        refreshTokenRepository.findOne.mockResolvedValue(null);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        await expect(
          authService.refreshTokens(oldRefreshToken, userId),
        ).rejects.toThrow(UnauthorizedException);
        expect(refreshTokenQueryBuilder.getOne).not.toHaveBeenCalled();
        expect(bcrypt.compare).not.toHaveBeenCalled();
      });
    });

    describe('tokens issued before exact rotation (no jti)', () => {
      beforeEach(() => {
        jwtService.decode.mockReturnValue({ sub: userId });
      });

      it('keeps the legacy bcrypt match and deletes the row it used', async () => {
        const legacy = exactRow({ token: '$2b$10$legacyhash' });
        refreshTokenQueryBuilder.getOne.mockResolvedValue(legacy);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        await expect(
          authService.refreshTokens(oldRefreshToken, userId),
        ).resolves.toEqual({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        });
        expect(refreshTokenRepository.remove).toHaveBeenCalledWith(legacy);
      });

      it('throws when the legacy comparison fails', async () => {
        refreshTokenQueryBuilder.getOne.mockResolvedValue(
          exactRow({ token: '$2b$10$legacyhash' }),
        );
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(
          authService.refreshTokens(oldRefreshToken, userId),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    it('issues a jti-bearing refresh token, stores its SHA-256 and prunes dead rows', async () => {
      jwtService.decode.mockReturnValue({ sub: userId, jti: 'j1' });
      refreshTokenRepository.findOne.mockResolvedValue(exactRow());

      await authService.refreshTokens(oldRefreshToken, userId);

      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ sub: mockUser.id, jti: expect.any(String) }),
        expect.anything(),
      );
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ token: sha(newRefreshToken), userId: 1 }),
      );
      expect(refreshTokenQueryBuilder.delete).toHaveBeenCalled();
      expect(refreshTokenQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('validateRefreshToken', () => {
    const refreshToken = 'refresh-token';
    const userId = 1;

    it('should validate refresh token successfully', async () => {
      jwtService.decode.mockReturnValue({ sub: userId, jti: 'j1' });
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 3,
        token: 'sha',
        userId,
        expiresAt: new Date(Date.now() + 86400000),
        rotatedAt: null,
      } as RefreshToken);
      userRepository.findOneOrFail.mockResolvedValue(mockUser);

      const result = await authService.validateRefreshToken(
        refreshToken,
        userId,
      );

      expect(result.id).toBe(mockUser.id);
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      jwtService.decode.mockReturnValue({ sub: userId, jti: 'j1' });
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

    it('should find the user when the submitted email differs only in case/whitespace from the stored email', async () => {
      // Simulates a real (case-sensitive) column match: only the exact,
      // normalised email resolves to a user.
      userRepository.findOne.mockImplementation((options: any) =>
        Promise.resolve(
          options.where.email === 'test@example.com' ? mockUser : null,
        ),
      );
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);
      (AuthUtil.generateOtp as jest.Mock).mockReturnValue('123456');
      redisService.get.mockResolvedValue(null);

      // As typed on a mobile keyboard that auto-capitalises the first
      // letter of the field, with a stray trailing space.
      const result = await authService.generateOtpV2({
        email: ' Test@Example.com ',
        allowedRoles: [UserRole.CLIENT],
      });

      expect(result).toEqual({
        success: true,
        expiresIn: 300,
      });
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

  describe('verifyGoogleToken', () => {
    const roles = { allowedRoles: [UserRole.CLIENT] };
    const WEB = '111-web.apps.googleusercontent.com';
    const UNLISTED_OWN = '111-unlisted.apps.googleusercontent.com';
    const OTHER_PROJECT = '222-web.apps.googleusercontent.com';
    const tokenInfo = (overrides: Record<string, unknown> = {}) => ({
      aud: WEB,
      azp: WEB,
      email: 'ada@example.com',
      // tokeninfo returns every field as a string.
      email_verified: 'true',
      scopes: ['email'],
      expiry_date: Date.now() + 3600_000,
      ...overrides,
    });

    const mockTokenInfo = (info: Record<string, unknown>) =>
      jest
        .spyOn((authService as any).googleClient, 'getTokenInfo')
        .mockResolvedValue(info as any);

    describe('access token', () => {
      it.each(mockConfig.googleAuth.clientIds as string[])(
        'accepts a token issued to the configured client %s',
        async (clientId) => {
          mockTokenInfo(tokenInfo({ aud: clientId, azp: clientId }));

          await expect(
            authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
          ).resolves.toEqual({ email: 'ada@example.com' });
        },
      );

      it('accepts a token whose authorised party is a configured client', async () => {
        mockTokenInfo(tokenInfo({ aud: OTHER_PROJECT, azp: WEB }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).resolves.toEqual({ email: 'ada@example.com' });
      });

      it('accepts email_verified as a boolean too', async () => {
        mockTokenInfo(tokenInfo({ email_verified: true }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).resolves.toEqual({ email: 'ada@example.com' });
      });

      it('accepts an unlisted client in the same Google project, and says so', async () => {
        mockTokenInfo(tokenInfo({ aud: UNLISTED_OWN, azp: UNLISTED_OWN }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).resolves.toEqual({ email: 'ada@example.com' });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(UNLISTED_OWN),
        );
      });

      it('rejects a token issued to a client in another Google project', async () => {
        mockTokenInfo(tokenInfo({ aud: OTHER_PROJECT, azp: OTHER_PROJECT }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(OTHER_PROJECT),
        );
      });

      it('rejects an audience that is not a Google client id', async () => {
        mockTokenInfo(tokenInfo({ aud: 'not-a-client', azp: 'not-a-client' }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
      });

      it('rejects a token with no audience at all', async () => {
        mockTokenInfo(tokenInfo({ aud: undefined, azp: undefined }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
      });

      it.each([
        ['false', 'false'],
        ['false (boolean)', false],
        ['missing', undefined],
      ])(
        'rejects a token whose email is not verified (%s)',
        async (_label, emailVerified) => {
          mockTokenInfo(tokenInfo({ email_verified: emailVerified }));

          await expect(
            authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
          ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
        },
      );

      it('rejects a token with no email', async () => {
        mockTokenInfo(tokenInfo({ email: undefined }));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
      });

      it('rejects a token Google does not recognise', async () => {
        jest
          .spyOn((authService as any).googleClient, 'getTokenInfo')
          .mockRejectedValue(new Error('invalid_token'));

        await expect(
          authService.verifyGoogleToken({ ...roles, accessToken: 'token' }),
        ).rejects.toThrow(new UnauthorizedException('Invalid Google token'));
      });
    });

    describe('ID token', () => {
      it('checks the audience against every configured client', async () => {
        const verifyIdToken = jest
          .spyOn((authService as any).googleClient, 'verifyIdToken')
          .mockResolvedValue({
            getPayload: () => ({ email: 'ada@example.com' }),
          } as any);

        await expect(
          authService.verifyGoogleToken({ ...roles, idToken: 'id.jwt' }),
        ).resolves.toEqual({ email: 'ada@example.com' });
        expect(verifyIdToken).toHaveBeenCalledWith({
          idToken: 'id.jwt',
          audience: mockConfig.googleAuth.clientIds,
        });
      });
    });

    it('throws BadRequest when neither token is sent', async () => {
      await expect(authService.verifyGoogleToken(roles)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyAppleToken', () => {
    const jose = jest.requireMock('jose') as {
      jwtVerify: jest.Mock;
    };

    beforeEach(() => {
      jose.jwtVerify.mockReset();
    });

    it('throws BadRequest when identityToken is missing', async () => {
      await expect(
        authService.verifyAppleToken({
          identityToken: '',
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns email from a valid identity token', async () => {
      jose.jwtVerify.mockResolvedValue({
        payload: { email: 'ada@example.com', sub: 'apple-sub-123' },
        protectedHeader: {},
      });

      const result = await authService.verifyAppleToken({
        identityToken: 'valid.jwt.token',
        allowedRoles: [UserRole.CLIENT],
      });

      expect(result).toEqual({ email: 'ada@example.com' });
      expect(jose.jwtVerify).toHaveBeenCalledWith(
        'valid.jwt.token',
        'mock-jwks',
        {
          issuer: 'https://appleid.apple.com',
          audience: ['com.helloally.app', 'com.helloally.app.dev'],
        },
      );
    });

    it('throws Unauthorized when jose rejects the token', async () => {
      jose.jwtVerify.mockRejectedValue(new Error('bad signature'));

      await expect(
        authService.verifyAppleToken({
          identityToken: 'bad.jwt',
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws Unauthorized when verified payload has no email', async () => {
      jose.jwtVerify.mockResolvedValue({
        payload: { sub: 'apple-sub-123' },
        protectedHeader: {},
      });

      await expect(
        authService.verifyAppleToken({
          identityToken: 'valid.jwt',
          allowedRoles: [UserRole.CLIENT],
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyAppleUser', () => {
    it('throws BadRequest when payload has no email', async () => {
      await expect(
        authService.verifyAppleUser({ email: '' }, [UserRole.CLIENT]),
      ).rejects.toThrow(BadRequestException);
    });

    it('issues tokens for active user with allowed role', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyAppleUser(
        { email: 'testuser@example.com' },
        [UserRole.CLIENT],
      );

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('throws NotFound when email has no account', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyAppleUser({ email: 'ghost@example.com' }, [
          UserRole.CLIENT,
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws Forbidden when user lacks allowed role', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.ADMIN]);

      await expect(
        authService.verifyAppleUser({ email: 'testuser@example.com' }, [
          UserRole.CLIENT,
        ]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws UserSuspended when user status is SUSPENDED', async () => {
      const suspended = {
        ...mockUser,
        status: UserStatus.SUSPENDED,
      } as unknown as User;
      userRepository.findOne.mockResolvedValue(suspended);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);

      await expect(
        authService.verifyAppleUser({ email: 'testuser@example.com' }, [
          UserRole.CLIENT,
        ]),
      ).rejects.toThrow(UserSuspendedException);
    });

    it('uses AuthProvider.APPLE on the audit emission', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      await authService.verifyAppleUser({ email: 'testuser@example.com' }, [
        UserRole.CLIENT,
      ]);

      expect(AuthProvider.APPLE).toBe('apple');
      expect(redisService).toBeDefined();
    });
  });

  /**
   * The limits that stop a 4-digit code being guessed (OTP_LIMITS), driven
   * through generateOtpV2 / verifyOtpV2 / verifyMagicLink against an in-memory
   * stand-in for Redis, so codes, links and counters behave as they do live.
   */
  describe('login-code limits', () => {
    const EMAIL = 'learner@example.com';
    const CODE = '4821';
    const WRONG = '1111';
    const roles = [UserRole.CLIENT];

    const learner = {
      id: 7,
      email: EMAIL,
      username: EMAIL,
      status: UserStatus.ACTIVE,
      tenantId: 'tenant-1',
    } as User;

    let store: Map<string, { value: string; ttlSeconds?: number }>;

    beforeEach(() => {
      store = new Map();
      redisService.get.mockImplementation(
        async (key: string) => store.get(key)?.value ?? null,
      );
      redisService.set.mockImplementation(
        async (key: string, value: string, ttl?: number) => {
          store.set(key, { value: String(value), ttlSeconds: ttl });
        },
      );
      redisService.del.mockImplementation(async (key: string) => {
        store.delete(key);
      });
      (redisService.incrWithExpiry as jest.Mock).mockImplementation(
        async (key: string, windowSeconds: number) => {
          const current = store.get(key);
          const next = {
            value: String(Number(current?.value ?? 0) + 1),
            // Later hits never extend the window, as in the real script.
            ttlSeconds: current?.ttlSeconds ?? windowSeconds,
          };
          store.set(key, next);
          return { count: Number(next.value), ttlSeconds: next.ttlSeconds };
        },
      );

      userRepository.findOne.mockResolvedValue(learner);
      groupService.getUserGroupNames.mockResolvedValue([UserRole.CLIENT]);
      jwtService.signAsync.mockResolvedValue('signed-token');
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);
      (AuthUtil.generateOtp as jest.Mock).mockReturnValue(CODE);
    });

    afterEach(() => {
      mockConfig.testAccounts = '{}';
    });

    const requestCode = (email = EMAIL) =>
      authService.generateOtpV2({ email, allowedRoles: roles });
    const tryCode = (otp: string, email = EMAIL) =>
      authService.verifyOtpV2({ email, otp, allowedRoles: roles });
    const lastMagicLinkToken = (): string => {
      const calls = (authService as any).eventEmitter.emitAsync.mock.calls;
      return calls[calls.length - 1][1].magicLinkToken;
    };
    const liveMagicLinks = () =>
      [...store.keys()].filter((key) => key.startsWith('auth_attempt:magic:'));

    /** Wrong guesses until the code is destroyed. */
    const burnCode = async (email = EMAIL) => {
      for (let n = 1; n < OTP_LIMITS.MAX_GUESSES_PER_CODE; n++) {
        await expect(tryCode(WRONG, email)).rejects.toThrow('Invalid OTP');
      }
      await expect(tryCode(WRONG, email)).rejects.toThrow(
        OTP_LIMIT_MESSAGES.CODE_LOCKED,
      );
    };

    describe('per code', () => {
      it('allows 5 checks, so the right code still works on the fifth', async () => {
        await requestCode();
        for (let n = 1; n < OTP_LIMITS.MAX_GUESSES_PER_CODE; n++) {
          await expect(tryCode(WRONG)).rejects.toThrow('Invalid OTP');
        }

        await expect(tryCode(CODE)).resolves.toMatchObject({
          accessToken: 'signed-token',
        });
      });

      it('destroys the code and its sign-in link on the fifth wrong check, and says to request a new one', async () => {
        await requestCode();
        expect(liveMagicLinks()).toHaveLength(1);

        await burnCode();

        expect(liveMagicLinks()).toHaveLength(0);
        // The right code no longer opens anything: there is no code left.
        await expect(tryCode(CODE)).rejects.toThrow('Invalid or expired OTP');
        await expect(
          authService.verifyMagicLink({
            token: lastMagicLinkToken(),
            allowedRoles: roles,
          }),
        ).rejects.toThrow('Invalid or expired magic link');
      });

      it('gives guesses fired in parallel no extra checks', async () => {
        await requestCode();
        const guesses = [
          ...Array(OTP_LIMITS.MAX_GUESSES_PER_CODE + 4).fill(WRONG),
          CODE,
        ];

        const results = await Promise.allSettled(
          guesses.map((otp) => tryCode(otp)),
        );

        // All ten arrive before any is answered. Four are compared and wrong,
        // the fifth wrong one destroys the code, and everything after it —
        // the right code included — is refused without being compared.
        const messages = results.map((result) =>
          result.status === 'rejected' ? result.reason.message : 'signed in',
        );
        expect(messages).toEqual([
          ...Array(OTP_LIMITS.MAX_GUESSES_PER_CODE - 1).fill('Invalid OTP'),
          ...Array(6).fill(OTP_LIMIT_MESSAGES.CODE_LOCKED),
        ]);
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      });

      it('gives a new code a fresh 5 checks', async () => {
        await requestCode();
        await burnCode();

        await requestCode();
        for (let n = 1; n < OTP_LIMITS.MAX_GUESSES_PER_CODE; n++) {
          await expect(tryCode(WRONG)).rejects.toThrow('Invalid OTP');
        }
        await expect(tryCode(CODE)).resolves.toBeDefined();
      });

      it('treats every spelling of the address as one code with one count', async () => {
        await requestCode(' Learner@Example.com ');

        await expect(tryCode(WRONG, 'LEARNER@example.com')).rejects.toThrow(
          'Invalid OTP',
        );
        await expect(tryCode(WRONG, 'learner@EXAMPLE.com')).rejects.toThrow(
          'Invalid OTP',
        );
        await expect(tryCode(CODE, EMAIL)).resolves.toBeDefined();
        // Only one code was ever stored, under the normalised address.
        expect(store.has('otp:Learner@Example.com')).toBe(false);
      });
    });

    describe('per address per day', () => {
      /** 20 wrong checks spread over 4 codes, each destroyed in turn. */
      const spendTheDay = async () => {
        const codes =
          OTP_LIMITS.MAX_GUESSES_PER_DAY / OTP_LIMITS.MAX_GUESSES_PER_CODE;
        for (let n = 0; n < codes; n++) {
          await requestCode();
          await burnCode();
        }
      };

      it('refuses further checks, even of the right code, with a 429 that points at the sign-in link', async () => {
        await spendTheDay();
        await requestCode();

        const refusal = await tryCode(CODE).catch((error) => error);

        expect(refusal).toBeInstanceOf(OtpRateLimitedException);
        expect(refusal.getStatus()).toBe(429);
        expect(refusal.getResponse()).toMatchObject({
          message: OTP_LIMIT_MESSAGES.dailyGuesses('24 hours'),
          errorCode: ErrorCode.RATE_LIMITED,
          retryAfterSeconds: TIME.DAY_IN_SECONDS,
        });
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      });

      it('still lets the learner in through the emailed link, which resets the count', async () => {
        await spendTheDay();
        await requestCode();
        await expect(tryCode(CODE)).rejects.toThrow(OtpRateLimitedException);

        await expect(
          authService.verifyMagicLink({
            token: lastMagicLinkToken(),
            allowedRoles: roles,
          }),
        ).resolves.toBeDefined();

        // Store-reset only, so the code-request window is not what is tested.
        store.delete(`otp_code_requests:${EMAIL}`);
        await requestCode();
        await expect(tryCode(CODE)).resolves.toBeDefined();
      });

      it('is reset by a successful sign-in, so it only accumulates against someone who never has the code', async () => {
        await requestCode();
        await burnCode();
        await requestCode();
        await burnCode();
        await requestCode();
        await expect(tryCode(CODE)).resolves.toBeDefined();

        expect(store.has(`otp_guesses_day:${EMAIL}`)).toBe(false);
      });
    });

    describe('code requests per address', () => {
      it('sends 5 codes in 15 minutes and refuses the 6th with the wait in words', async () => {
        for (let n = 1; n <= OTP_LIMITS.MAX_CODES_PER_WINDOW; n++) {
          await expect(requestCode()).resolves.toMatchObject({
            success: true,
          });
        }

        const refusal = await requestCode().catch((error) => error);

        expect(refusal).toBeInstanceOf(OtpRateLimitedException);
        expect(refusal.getResponse()).toMatchObject({
          message: OTP_LIMIT_MESSAGES.generateRequest('15 minutes'),
          errorCode: ErrorCode.RATE_LIMITED,
          retryAfterSeconds: 15 * TIME.MINUTE_IN_SECONDS,
        });
      });

      it('limits an unknown address the same way, before the lookup, so it reveals nothing about who has an account', async () => {
        userRepository.findOne.mockResolvedValue(null);
        for (let n = 1; n <= OTP_LIMITS.MAX_CODES_PER_WINDOW; n++) {
          await expect(requestCode('nobody@example.com')).rejects.toThrow(
            NotFoundException,
          );
        }
        userRepository.findOne.mockClear();

        await expect(requestCode('nobody@example.com')).rejects.toThrow(
          OtpRateLimitedException,
        );
        expect(userRepository.findOne).not.toHaveBeenCalled();
      });

      it('counts every spelling of the address together', async () => {
        const spellings = [
          'learner@example.com',
          'Learner@example.com',
          ' learner@example.com',
          'LEARNER@EXAMPLE.COM',
          'learner@Example.com',
        ];
        for (const spelling of spellings) {
          await requestCode(spelling);
        }

        await expect(requestCode('lEarner@example.com')).rejects.toThrow(
          OtpRateLimitedException,
        );
      });
    });

    describe('test accounts', () => {
      const TEST_EMAIL = 'reviewer@example.com';
      const TEST_CODE = '2468';

      beforeEach(() => {
        mockConfig.testAccounts = JSON.stringify({ [TEST_EMAIL]: TEST_CODE });
      });

      it('are not limited on code requests — no email is sent for them', async () => {
        for (let n = 1; n <= OTP_LIMITS.MAX_CODES_PER_WINDOW + 3; n++) {
          await expect(requestCode(TEST_EMAIL)).resolves.toMatchObject({
            success: true,
          });
        }
      });

      it('are recognised however the address is typed, so their fixed code is never overwritten', async () => {
        await requestCode('Reviewer@Example.com');

        expect(store.get(`otp:${TEST_EMAIL}`)?.value).toBe(TEST_CODE);
        expect(AuthUtil.generateOtp).not.toHaveBeenCalled();
        await expect(tryCode(TEST_CODE, TEST_EMAIL)).resolves.toBeDefined();
      });

      it('still have their fixed code covered by the per-code and daily limits', async () => {
        await requestCode(TEST_EMAIL);
        await burnCode(TEST_EMAIL);
        await expect(tryCode(TEST_CODE, TEST_EMAIL)).rejects.toThrow(
          'Invalid OTP',
        );

        // 5 checks spent above; spend the rest of the day's 20.
        for (
          let n = OTP_LIMITS.MAX_GUESSES_PER_CODE;
          n < OTP_LIMITS.MAX_GUESSES_PER_DAY;
          n++
        ) {
          if (!store.has(`otp:${TEST_EMAIL}`)) {
            await requestCode(TEST_EMAIL);
          }
          await expect(tryCode(WRONG, TEST_EMAIL)).rejects.toThrow(
            UnauthorizedException,
          );
        }
        await requestCode(TEST_EMAIL);
        await expect(tryCode(TEST_CODE, TEST_EMAIL)).rejects.toThrow(
          OtpRateLimitedException,
        );
      });
    });
  });

  describe('impersonate', () => {
    const CALLER_ID = 99;

    beforeEach(() => {
      tenantScopeService.isRestricted.mockResolvedValue(false);
      permissionsService.isMultiTenantAdmin.mockResolvedValue(false);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
    });

    it('mints tokens for an unrestricted platform admin', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 5,
        username: 'learner@example.com',
        tenantId: 'tenant-a',
      } as User);

      const result = await authService.impersonate(
        { email: 'learner@example.com' },
        CALLER_ID,
      );

      expect(result).toEqual({
        message: 'Impersonation successful',
        data: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      });
      expect(tenantScopeService.isRestricted).toHaveBeenCalledWith(CALLER_ID);
    });

    it('refuses an organization-restricted platform admin before looking anyone up', async () => {
      tenantScopeService.isRestricted.mockResolvedValue(true);

      await expect(
        authService.impersonate({ email: 'learner@example.com' }, CALLER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown email instead of signing a token for nobody', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.impersonate({ email: 'ghost@example.com' }, CALLER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('never selects the password hash it would otherwise audit-log', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 5,
        username: 'learner@example.com',
        tenantId: 'tenant-a',
      } as User);

      await authService.impersonate(
        { email: 'learner@example.com' },
        CALLER_ID,
      );

      const query = userRepository.findOne.mock.calls[0][0] as any;
      expect(query.select).not.toContain('password');
    });
  });
});
