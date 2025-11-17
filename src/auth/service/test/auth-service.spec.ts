import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
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

// Mock bcrypt at the module level
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../../util/auth.util', () => ({
  AuthUtil: {
    generateOtp: jest.fn(),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;
  let jwtService: jest.Mocked<JwtService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
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

  const mockConfig = {
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
    eventEmitter = module.get(EventEmitter2);
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

      refreshTokenRepository.findOne.mockResolvedValue(tokenEntity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      refreshTokenRepository.remove.mockResolvedValue(tokenEntity);
      userRepository.findOneOrFail.mockResolvedValue(mockUser);
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

  describe('generateOtp', () => {
    const email = 'test@example.com';
    const phone = '+1234567890';

    it('should return true for non-existent user to prevent enumeration', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await authService.generateOtp(phone, email);

      expect(result).toBe(true);
    });

    it('should throw BadRequestException when neither email nor phone provided', async () => {
      await expect(authService.generateOtp()).rejects.toThrow(
        new BadRequestException('Email or phone is required'),
      );
    });

    it('should return true when user has no email', async () => {
      const userWithoutEmail = {
        ...mockUser,
        email: undefined,
      } as unknown as User;
      userRepository.findOne.mockResolvedValue(userWithoutEmail);

      const result = await authService.generateOtp(phone);

      expect(result).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `User ${userWithoutEmail.id} has no email`,
      );
    });

    it('should generate OTP for test account', async () => {
      const testEmail = 'test@example.com';
      const testOtp = '999999';
      mockConfig.testAccounts = JSON.stringify({ [testEmail]: testOtp });
      userRepository.findOne.mockResolvedValue({
        ...mockUser,
        email: testEmail,
      } as unknown as User);

      const result = await authService.generateOtp(undefined, testEmail);

      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalledWith(
        `otp:${testEmail}`,
        testOtp,
        300,
      );
    });

    it('should handle invalid TEST_ACCOUNTS JSON', async () => {
      mockConfig.testAccounts = '{invalid}';
      userRepository.findOne.mockResolvedValue(mockUser);
      (AuthUtil.generateOtp as jest.Mock).mockReturnValue('123456');

      await authService.generateOtp(phone, email);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid TEST_ACCOUNTS JSON format',
      );
    });

    it('should generate random OTP for regular user', async () => {
      mockConfig.testAccounts = '{}';
      const otp = '123456';
      userRepository.findOne.mockResolvedValue(mockUser);
      (AuthUtil.generateOtp as jest.Mock).mockReturnValue(otp);

      const result = await authService.generateOtp(phone, email);

      expect(result).toBe(true);
      expect(redisService.set).toHaveBeenCalledWith(
        `otp:${mockUser.email}`,
        otp,
        300,
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('otp.generated', {
        email: mockUser.email,
        otp,
      });
    });
  });

  describe('verifyOtp', () => {
    const otp = '123456';
    const email = 'test@example.com';
    const phone = '+1234567890';

    it('should verify OTP and return tokens for valid OTP', async () => {
      const accessToken = 'access-token';
      const refreshToken = 'refresh-token';

      userRepository.findOne.mockResolvedValue(mockUser);
      redisService.get.mockResolvedValue(otp);
      redisService.del.mockResolvedValue();
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtp(otp, phone, email);

      expect(result?.accessToken).toBe(accessToken);
    });

    it('should throw BadRequestException for invalid OTP', async () => {
      redisService.get.mockResolvedValue('different-otp');

      await expect(authService.verifyOtp(otp, phone, email)).rejects.toThrow(
        new BadRequestException('Invalid OTP'),
      );
    });

    it('should throw BadRequestException when neither email nor phone provided', async () => {
      await expect(authService.verifyOtp(otp)).rejects.toThrow(
        new BadRequestException('Email or phone is required'),
      );
    });

    it('should find user by phone', async () => {
      const accessToken = 'access-token';
      const refreshToken = 'refresh-token';

      userRepository.findOne.mockResolvedValue(mockUser);
      redisService.get.mockResolvedValue(otp);
      redisService.del.mockResolvedValue();
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtp(otp, phone);

      expect(result).toBeDefined();
    });

    it('should throw when user by phone has no email', async () => {
      const userWithoutEmail = {
        ...mockUser,
        email: undefined,
      } as unknown as User;
      userRepository.findOne.mockResolvedValue(userWithoutEmail);

      await expect(authService.verifyOtp(otp, phone)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when user not found after OTP check', async () => {
      redisService.get.mockResolvedValue(otp);
      redisService.del.mockResolvedValue();
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.verifyOtp(otp, undefined, email),
      ).rejects.toThrow(BadRequestException);
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

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw BadRequestException when email is not provided', async () => {
      const invalidDto = { ...mockVerifyOtpDto, email: '' };

      await expect(authService.verifyOtpV2(invalidDto)).rejects.toThrow(
        new BadRequestException('Email is required'),
      );
    });

    it('should throw BadRequestException when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow(
        new BadRequestException('Invalid OTP'),
      );
    });

    it('should throw UserSuspendedException when user is suspended', async () => {
      userRepository.findOne.mockResolvedValue(mockSuspendedUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('123456'); // Provide valid OTP

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow(
        UserSuspendedException,
      );
    });

    it('should throw BadRequestException when user is not authorized', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']); // Different role

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow(
        new BadRequestException('Invalid otp'),
      );
    });

    it('should throw BadRequestException when OTP is invalid', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('different-otp');

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow(
        new BadRequestException('Invalid OTP'),
      );
    });

    it('should successfully verify OTP and return tokens', async () => {
      const accessToken = 'access-token';
      const refreshToken = 'refresh-token';

      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('123456');
      redisService.del.mockResolvedValue();
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce(accessToken)
        .mockResolvedValueOnce(refreshToken);
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtpV2(mockVerifyOtpDto);

      expect(result).toEqual({
        user: {
          id: mockUser.id,
          username: mockUser.username,
        },
        accessToken,
        refreshToken,
        tokenType: 'bearer',
      });

      expect(redisService.del).toHaveBeenCalledWith(`otp:${mockUser.email}`);
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it('should log error when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User not found for email ${mockVerifyOtpDto.email}`,
      );
    });

    it('should log error when user is suspended', async () => {
      const suspendedDto = {
        ...mockVerifyOtpDto,
        email: mockSuspendedUser.email,
      };
      userRepository.findOne.mockResolvedValue(mockSuspendedUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('123456'); // Provide valid OTP

      await expect(authService.verifyOtpV2(suspendedDto)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User ${mockSuspendedUser.email} is suspended`,
      );
    });

    it('should log error when user is not authorized', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']);

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `User not authorized for email ${mockVerifyOtpDto.email}`,
      );
    });

    it('should log error when OTP is invalid', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('different-otp');

      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Invalid OTP for email ${mockVerifyOtpDto.email}`,
      );
    });

    it('should call logOtpVerificationError for all error scenarios', async () => {
      const logOtpVerificationErrorSpy = jest.spyOn(
        authService as any,
        'logOtpVerificationError',
      );

      // Test user not found
      userRepository.findOne.mockResolvedValue(null);
      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();
      expect(logOtpVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'User not found',
      );

      // Test user suspended
      const suspendedDto = {
        ...mockVerifyOtpDto,
        email: mockSuspendedUser.email,
      };
      userRepository.findOne.mockResolvedValue(mockSuspendedUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('123456'); // Provide valid OTP
      await expect(authService.verifyOtpV2(suspendedDto)).rejects.toThrow();
      expect(logOtpVerificationErrorSpy).toHaveBeenCalledWith(
        mockSuspendedUser.email,
        'User suspended',
      );

      // Test user not authorized
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['ADMIN']);
      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();
      expect(logOtpVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'User not authorized',
      );

      // Test invalid OTP
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('different-otp');
      await expect(authService.verifyOtpV2(mockVerifyOtpDto)).rejects.toThrow();
      expect(logOtpVerificationErrorSpy).toHaveBeenCalledWith(
        mockVerifyOtpDto.email,
        'Invalid OTP',
      );

      logOtpVerificationErrorSpy.mockRestore();
    });

    it('should log audit event on successful verification', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      groupService.getUserGroupNames.mockResolvedValue(['CLIENT']);
      redisService.get.mockResolvedValue('123456');
      redisService.del.mockResolvedValue();
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      refreshTokenRepository.save.mockResolvedValue({} as RefreshToken);

      const result = await authService.verifyOtpV2(mockVerifyOtpDto);

      expect(result).toBeDefined();
      expect(result.user.id).toBe(mockUser.id);
    });
  });
});
