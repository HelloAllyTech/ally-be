import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository, MoreThan, In } from 'typeorm';
import { User } from '../../common/entities/user.entity';
import { UserGroup } from '../../common/entities/user-group.entity';
import { Group } from '../../common/entities/group.entity';
import * as bcrypt from 'bcrypt';
import { RefreshToken } from '../../common/entities/refresh-token.entity';
import { AppConfigService } from '../../config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserStatus } from '../../common/constants/user.constants';
import { UserCreateDto } from '../dto/user-create.dto';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from '../../logger/logger.service';
import { AuthUtil } from '../util/auth.util';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';

@Injectable()
export class AuthService {
  private readonly PASSWORD_MIN_LENGTH = 6; // Move to config service if needed
  private readonly logger = LoggerService.getInstance(AuthService.name);
  private readonly OTP_TTL;
  private userRepository: Repository<User>;
  private refreshTokenRepository: Repository<RefreshToken>;
  private userGroupRepository: Repository<UserGroup>;
  private groupRepository: Repository<Group>;
  private readonly auditLogger = AuditLoggerService.getInstance();
  constructor(
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: AppConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
  ) {
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.userGroupRepository = this.dataSource.getRepository(UserGroup);
    this.groupRepository = this.dataSource.getRepository(Group);
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.OTP_TTL = +this.configService.otp.ttl;
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

  private async generateTokens(user: User) {
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

  async signup(userData: UserCreateDto): Promise<Omit<User, 'password'>> {
    // Check if user with email or phone already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ email: userData.email }, { phone: userData.phone }],
      select: ['email', 'phone'],
    });

    if (existingUser) {
      if (existingUser.email === userData.email) {
        throw new BadRequestException('Email already registered');
      }
      throw new BadRequestException('Phone number already registered');
    }

    // Hash password
    const hashedPassword = userData.password
      ? await bcrypt.hash(userData.password, 10)
      : undefined;

    // Create new user
    const newUser = this.userRepository.create({
      email: userData.email,
      password: hashedPassword,
      name: userData.name,
      status: UserStatus.ACTIVE,
      metadata: {},
      username: userData.username || userData.email,
      phone: userData.phone,
      tenantId: userData.tenantId,
      externalId: userData.externalId,
    });

    // Save user
    const savedUser = await this.userRepository.save(newUser);

    const groups = await this.groupRepository.find({
      where: { name: In(userData.roles) },
    });

    if (groups.length > 0) {
      // Add user to default group
      const groupsData = groups.map((group) =>
        this.userGroupRepository.create({
          userId: savedUser.id,
          groupId: group.id,
        }),
      );
      await this.userGroupRepository.save(groupsData);
    }

    // Emit user created event
    this.eventEmitter.emit('user.created', {
      userId: savedUser.id,
    });
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.USER_SIGNUP,
      tenantId: savedUser.tenantId,
      userId: savedUser.id,
      details: {
        username: savedUser.username,
        email: savedUser.email,
        phone: savedUser.phone,
      },
    });

    // Remove password from response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = savedUser;
    return userWithoutPassword;
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

  async generateOtp(phone?: string, email?: string) {
    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required');
    }
    const user = await this.userRepository.findOne({
      where: [{ phone: phone }, { email: email }],
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

    let testAccounts: Record<string, string> = {};
    try {
      testAccounts = JSON.parse(this.configService.testAccounts || '{}');
    } catch (error) {
      this.logger.error('Invalid TEST_ACCOUNTS JSON format');
    }
    if (testAccounts[user.email]) {
      const otp = testAccounts[user.email];
      await this.cache.set(this.getOtpKey(user.email), otp, this.OTP_TTL);
      this.logger.info(`OTP for test account ${user.email} generated`);
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

  private logOtpVerificationError(
    username: string | undefined,
    reason: string,
  ) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.OTP_VERIFICATION_FAILED,
      details: {
        username,
        reason,
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
        where: { phone },
      });
      if (!user || !user.email) {
        this.logOtpVerificationError(phone, 'User not found');
        throw new BadRequestException('User not found');
      }
      email = user.email;
    }

    const cachedOtp = await this.cache.get(this.getOtpKey(email));
    if (cachedOtp !== otp) {
      this.logOtpVerificationError(email, 'Invalid OTP');
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
        this.logOtpVerificationError(email, 'User not found');
        throw new BadRequestException('User not found');
      }
      const tokens = await this.generateTokens(user);

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.OTP_VERIFICATION_SUCCESS,
        tenantId: user.tenantId,
        userId: user.id,
        details: {
          phone,
          email,
          otp,
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

  private getOtpKey(email: string) {
    return `otp:${email}`;
  }
}
