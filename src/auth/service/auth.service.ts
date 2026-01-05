import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository, MoreThan, In } from 'typeorm';
import { User } from '../../user/entity/user.entity';
import * as bcrypt from 'bcrypt';
import { RefreshToken } from '../entity/refresh-token.entity';
import { AppConfigService } from '../../config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserStatus } from '../../user/constants/user-status.constants';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from '../../logger/logger.service';
import { AuthUtil } from '../util/auth.util';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { GroupService } from 'src/authorization/service/group.service';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import {
  AuthenticationResponseDto,
  GenerateOtpV2Dto,
  GenerateOtpV2ResponseDto,
  VerifyOtpV2Dto,
} from '../dto/login.dto';
import { UserSuspendedException } from '../exception/login.exception';
import { UserRole } from 'src/common/constants/user.constants';
import { AuthProvider } from '../type/auth.types';

@Injectable()
export class AuthService {
  private readonly logger = LoggerService.getInstance(AuthService.name);
  private readonly OTP_TTL;
  private userRepository: Repository<User>;
  private refreshTokenRepository: Repository<RefreshToken>;
  private readonly auditLogger = AuditLoggerService.getInstance();
  private readonly googleClient: OAuth2Client;
  constructor(
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: AppConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
    private readonly groupService: GroupService,
  ) {
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.OTP_TTL = +this.configService.otp.ttl;
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID!);
  }

  // ... existing validateUser and validateUserById methods ...

  async validateRefreshToken(refreshToken: string, userId: number) {
    const token = await this.refreshTokenRepository.findOne({
      where: {
        userId: userId,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!token || !(await bcrypt.compare(refreshToken, token.token))) {
      throw new UnauthorizedException();
    }

    const user = await this.userRepository.findOneOrFail({
      where: { id: userId },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;
    return result;
  }

  async generateTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = {
      sub: user.id,
      username: user.username,
      tenantId: user.tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.jwt.accessToken.expiresIn,
        secret: this.configService.jwt.accessToken.secret,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.jwt.refreshToken.expiresIn,
        secret: this.configService.jwt.refreshToken.secret,
      }),
    ]);

    // Calculate expiry date based on config
    const ttlDays = this.configService.jwt.refreshToken.ttlDays;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    // Store the hashed refresh token in DB
    await this.refreshTokenRepository.save({
      token: await bcrypt.hash(refreshToken, 10),
      userId: user.id,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshTokens(oldRefreshToken: string, userId: number) {
    // Find and validate the old refresh token
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: {
        userId,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (
      !tokenEntity ||
      !(await bcrypt.compare(oldRefreshToken, tokenEntity.token))
    ) {
      throw new UnauthorizedException();
    }

    // Delete the old refresh token (rotation)
    await this.refreshTokenRepository.remove(tokenEntity);

    // Generate new tokens
    const user = await this.userRepository.findOneOrFail({
      where: { id: userId },
    });
    return this.generateTokens(user);
  }

  private logLoginError(username: string) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_LOGIN_FAILED,
      details: {
        username,
        reason: 'Invalid username or password',
      },
    });
  }

  async login(username: string, password: string) {
    const user = await this.userRepository.findOne({
      where: { username },
      select: ['id', 'username', 'password', 'tenantId'],
    });

    if (!user) {
      this.logLoginError(username);
      throw new UnauthorizedException('Invalid username or password');
    }

    if (!user.password) {
      this.logLoginError(username);
      throw new UnauthorizedException('Invalid username or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logLoginError(username);
      throw new UnauthorizedException('Invalid username or password');
    }

    const tokens = await this.generateTokens(user);
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_LOGIN_SUCCESS,
      tenantId: user.tenantId,
      userId: user.id,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
      },
      ...tokens,
      tokenType: 'bearer',
    };
  }

  async logout(userId: number) {
    // Delete all refresh tokens for the user
    await this.refreshTokenRepository.delete({ userId });
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_LOGOUT,
    });
  }

  private logOtpGenerationError(username: string | undefined, reason: string) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.OTP_GENERATION_FAILED,
      details: {
        username,
        reason,
      },
    });
  }

  private async handleTestAccountOtp(email: string) {
    let testAccounts: Record<string, string> = {};
    try {
      testAccounts = JSON.parse(this.configService.testAccounts || '{}');
    } catch (error) {
      this.logger.error('Invalid TEST_ACCOUNTS JSON format');
    }
    if (testAccounts[email]) {
      const otp = testAccounts[email];
      await this.cache.set(this.getOtpKey(email), otp, this.OTP_TTL);
      this.logger.info(`OTP for test account ${email} generated`);
      return true;
    }
    return false;
  }

  async generateOtp(phone?: string, email?: string) {
    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const whereConditions = [];
    if (phone) {
      whereConditions.push({
        phone,
        status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
      });
    }
    if (email) {
      whereConditions.push({
        email,
        status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
      });
    }

    const user = await this.userRepository.findOne({
      where: whereConditions,
    });
    if (!user) {
      this.logger.error(`User not found for phone ${phone} or email ${email}`);
      this.logOtpGenerationError(email || phone, 'User not found');
      return true; // to prevent user enumeration
    }

    if (!user.email) {
      this.logger.error(`User ${user.id} has no email`);
      this.logOtpGenerationError(phone, 'User has no email');
      return true;
    }

    const isTestAccount = await this.handleTestAccountOtp(user.email);
    if (isTestAccount) {
      return true;
    }

    const otp = AuthUtil.generateOtp();
    await this.cache.set(this.getOtpKey(user.email), otp, this.OTP_TTL);
    // send otp to user
    this.eventEmitter.emit('otp.generated', {
      email: user.email,
      otp,
    });

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.OTP_GENERATION_SUCCESS,
      details: {
        email: user.email,
        phone,
        medium: 'email',
      },
    });
    return true;
  }

  async generateOtpV2(
    generateOtpDto: GenerateOtpV2Dto,
  ): Promise<GenerateOtpV2ResponseDto> {
    const { email, allowedRoles } = generateOtpDto;
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    const user = await this.userRepository.findOne({
      where: { email, status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]) },
    });

    if (!user) {
      this.logger.error(`User not found for email ${email}`);
      this.logOtpGenerationError(email, 'User not found');
      return { success: true, expiresIn: this.OTP_TTL };
    }

    const userGroups = await this.groupService.getUserGroupNames(user.id);
    const hasAllowedRoles = allowedRoles.some((role) =>
      userGroups.includes(role),
    );
    if (!hasAllowedRoles) {
      this.logger.error(`User not authorized for email ${email}`);
      this.logOtpGenerationError(email, 'User not authorized');
      return { success: true, expiresIn: this.OTP_TTL };
    }

    const isTestAccount = await this.handleTestAccountOtp(email);
    if (isTestAccount) {
      return { success: true, expiresIn: this.OTP_TTL };
    }

    const otp = AuthUtil.generateOtp();
    await this.cache.set(this.getOtpKey(email), otp, this.OTP_TTL);

    this.eventEmitter.emit('otp.generated', {
      email,
      otp,
    });
    return {
      success: true,
      expiresIn: this.OTP_TTL,
    };
  }

  private logVerificationError(
    username: string | undefined,
    reason: string,
    authProvider: AuthProvider,
  ) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_lOGIN_VERIFICATION_FAILED,
      details: {
        username,
        reason,
        authProvider,
      },
    });
  }

  async verifyOtp(otp: string, phone?: string, email?: string) {
    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required');
    }

    let user;
    if (!email) {
      user = await this.userRepository.findOne({
        where: { phone, status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]) },
      });
      if (!user || !user.email) {
        this.logVerificationError(
          phone,
          'User not found',
          AuthProvider.EMAIL_OTP,
        );
        throw new BadRequestException('User not found');
      }
      email = user.email;
    }

    const cachedOtp = await this.cache.get(this.getOtpKey(email));
    if (cachedOtp !== otp) {
      this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
      throw new BadRequestException('Invalid OTP');
    }
    await this.cache.del(this.getOtpKey(email));

    if (cachedOtp === otp) {
      // generate token
      if (!user) {
        user = await this.userRepository.findOne({
          where: { email },
        });
      }
      if (!user) {
        this.logVerificationError(
          email,
          'User not found',
          AuthProvider.EMAIL_OTP,
        );
        throw new BadRequestException('User not found');
      }

      if (user.status === UserStatus.SUSPENDED) {
        this.logger.error(`User ${email} is suspended`);
        this.logVerificationError(
          email,
          'User suspended',
          AuthProvider.EMAIL_OTP,
        );
        throw new UserSuspendedException();
      }

      const tokens = await this.generateTokens(user);

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.OTP_VERIFICATION_SUCCESS,
        tenantId: user.tenantId,
        userId: user.id,
        details: {
          phone,
          email,
        },
      });

      return {
        user: {
          id: user!.id,
          username: user!.username,
        },
        ...tokens,
        tokenType: 'bearer',
      };
    }
  }

  async verifyOtpV2(
    verifyOtpDto: VerifyOtpV2Dto,
  ): Promise<AuthenticationResponseDto> {
    const { otp, email, allowedRoles } = verifyOtpDto;
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    const cachedOtp = await this.cache.get(this.getOtpKey(email));
    if (cachedOtp !== otp) {
      this.logger.error(`Invalid OTP for email ${email}`);
      this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
      throw new BadRequestException('Invalid OTP');
    }
    await this.cache.del(this.getOtpKey(email));

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.EMAIL_OTP,
    );
  }

  private getOtpKey(email: string) {
    return `otp:${email}`;
  }

  async verifyGoogleIdToken(idToken: string): Promise<TokenPayload> {
    try {
      const allowedAudiences = [
        this.configService.googleAuth.androidClientId,
        this.configService.googleAuth.iosClientId,
        this.configService.googleAuth.webClientId,
      ] as string[];

      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: allowedAudiences,
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new UnauthorizedException('Invalid Google token');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  async verifyGoogleUser(
    payload: TokenPayload,
    allowedRoles: UserRole[],
  ): Promise<AuthenticationResponseDto> {
    const { email } = payload;
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.GOOGLE,
    );
  }

  private async validateUserAndIssueTokens(
    allowedRoles: UserRole[],
    email: string,
    authProvider: AuthProvider,
  ): Promise<AuthenticationResponseDto> {
    const user = await this.userRepository.findOne({
      where: { email, status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]) },
    });

    const errorMessage =
      await this.getUserVerificationErrorMessage(authProvider);

    if (!user) {
      this.logger.error(`User not found for email ${email}`);
      this.logVerificationError(email, 'User not found', authProvider);
      throw new BadRequestException(errorMessage);
    }

    const userGroups = await this.groupService.getUserGroupNames(user.id);
    const hasAllowedRoles = allowedRoles.some((role) =>
      userGroups.includes(role),
    );

    if (!hasAllowedRoles) {
      this.logger.error(`User not authorized for email ${user.email}`);
      this.logVerificationError(user.email, 'User not found', authProvider);
      throw new BadRequestException(errorMessage);
    }

    if (user.status === UserStatus.SUSPENDED) {
      this.logger.error(`User ${user.email} is suspended`);
      throw new UserSuspendedException();
    }

    const tokens = await this.generateTokens(user);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_lOGIN_VERIFICATION_SUCCESS,
      tenantId: user.tenantId,
      userId: user.id,
      details: {
        email,
        authProvider,
      },
    });

    return {
      user: {
        id: user!.id,
        username: user!.username,
      },
      ...tokens,
      tokenType: 'bearer',
    };
  }

  private getUserVerificationErrorMessage(provider: AuthProvider): string {
    switch (provider) {
      case AuthProvider.GOOGLE:
        return 'Google sign in failed';

      case AuthProvider.EMAIL_OTP:
        return 'Invalid OTP';

      default:
        return 'Authentication failed';
    }
  }
}
