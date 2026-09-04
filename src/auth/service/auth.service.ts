import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
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
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  AuthenticationResponseDto,
  GenerateOtpV2Dto,
  GenerateOtpV2ResponseDto,
  VerifyOtpV2Dto,
} from '../dto/login.dto';
import { UserSuspendedException } from '../exception/login.exception';
import { UserRole } from 'src/common/constants/user.constants';
import {
  AppleTokenPayload,
  AuthProvider,
  GoogleTokenPayload,
} from '../type/auth.types';
import { GoogleSignInDto } from '../dto/google-token.dto';
import { AppleSignInDto } from '../dto/apple-token.dto';
import * as crypto from 'crypto';
import { MagicLinkVerifyDto } from '../dto/magic-link.dto';
import { EmailSendFailedException } from 'src/aws/service/ses.service';
import { CachedAuthAttempt } from '../interface/cached-auth-attempt.interface';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { Impersonate } from '../interface/impersonate.interface';

@Injectable()
export class AuthService {
  private readonly logger = LoggerService.getInstance(AuthService.name);
  private readonly OTP_TTL;
  private userRepository: Repository<User>;
  private refreshTokenRepository: Repository<RefreshToken>;
  private readonly auditLogger = AuditLoggerService.getInstance();
  private readonly googleClient: OAuth2Client;
  private readonly appleJwks = createRemoteJWKSet(
    new URL('https://appleid.apple.com/auth/keys'),
  );
  private static readonly APPLE_ISSUER = 'https://appleid.apple.com';

  constructor(
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: AppConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
    private readonly groupService: GroupService,
    private permissionsService: PermissionsService,
  ) {
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.OTP_TTL = +this.configService.otp.ttl;
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID!);
  }

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

  async impersonate(ImpersonateData: Impersonate) {
    const userEmail = ImpersonateData.email;

    const user = await this.userRepository.findOne({
      where: { email: userEmail, status: UserStatus.ACTIVE },
      select: ['id', 'username', 'password', 'tenantId'],
    });

    const isMultitenantAdmin = await this.permissionsService.isMultiTenantAdmin(
      Number(user?.id),
    );

    if (isMultitenantAdmin)
      return { message: 'Multi-tenant admin cannot be impersonated.' };

    const tokens = await this.generateTokens(user as User);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.SUPER_ADMIN_IMPERSONATE,
      details: {
        purpose: 'Super admin impersonated a user',
        userDetails: user,
      },
    });
    return { message: 'Impersonation successful', data: tokens };
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
        expiresIn: this.configService.jwt.accessToken.expiresIn as any,
        secret: this.configService.jwt.accessToken.secret,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.jwt.refreshToken.expiresIn as any,
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
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.SUSPENDED) {
      this.logger.error(
        `User ${user.email} is suspended while refreshing tokens`,
      );
      throw new UserSuspendedException();
    }
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

  private getTestAccounts(): Record<string, string> {
    try {
      return JSON.parse(this.configService.testAccounts || '{}');
    } catch {
      this.logger.error('Invalid TEST_ACCOUNTS JSON format');
      return {};
    }
  }

  private async handleTestAccountOtp(email: string) {
    const testAccounts = this.getTestAccounts();
    if (testAccounts[email]) {
      const otp = testAccounts[email];
      await this.cache.set(this.getOtpKey(email), otp, this.OTP_TTL);
      this.logger.info(`OTP for test account ${email} generated`);
      return true;
    }
    return false;
  }

  async generateOtpV2(
    generateOtpDto: GenerateOtpV2Dto,
  ): Promise<GenerateOtpV2ResponseDto> {
    const { email, allowedRoles, appType } = generateOtpDto;
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    // Trim + lowercase before the lookup: accounts are stored normalised
    // this way (see `UserService.bulkAddUsers`), but mobile keyboards
    // routinely auto-capitalise the first letter of an email field. A
    // literal-match query against a normalised account made a real,
    // correctly-typed login silently 404 here, which read to the user as
    // "the OTP email never arrived".
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.userRepository.findOne({
      where: {
        email: normalizedEmail,
        status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
      },
    });

    if (!user) {
      this.logger.error(`User not found for email ${email}`);
      this.logOtpGenerationError(email, 'User not found');
      throw new NotFoundException(
        'No account found associated with this email',
      );
    }

    const userGroups = await this.groupService.getUserGroupNames(user.id);
    const hasAllowedRoles = allowedRoles.some((role) =>
      userGroups.includes(role),
    );
    if (!hasAllowedRoles) {
      this.logger.error(`User not authorized for email ${email}`);
      this.logOtpGenerationError(email, 'User not authorized');
      throw new ForbiddenException(
        'This account does not have the required role',
      );
    }

    const isTestAccount = await this.handleTestAccountOtp(email);
    if (isTestAccount) {
      return { success: true, expiresIn: this.OTP_TTL };
    }
    // Delete existing unused attempt from cache
    const existingAttempt = await this.cache.get(this.getAuthAttemptKey(email));
    if (existingAttempt) {
      const parsed: CachedAuthAttempt = JSON.parse(existingAttempt);
      await this.cache.del(this.getMagicTokenKey(parsed.magicTokenHash));
      await this.cache.del(this.getAuthAttemptKey(email));
    }

    const otp = AuthUtil.generateOtp();
    const { magicToken, otpHash, magicTokenHash, expiresAt } =
      this.generateMagicTokenCredentials(otp);

    const attemptData: CachedAuthAttempt = {
      email,
      otpHash,
      magicTokenHash,
      expiresAt: expiresAt.toISOString(),
    };
    await this.cache.set(
      this.getAuthAttemptKey(email),
      JSON.stringify(attemptData),
      this.OTP_TTL,
    );
    await this.cache.set(
      this.getMagicTokenKey(magicTokenHash),
      email,
      this.OTP_TTL,
    );
    await this.cache.set(this.getOtpKey(email), otp, this.OTP_TTL);

    // `emitAsync`, not `emit`, and the result is inspected.
    //
    // This used to fire and forget, then return `{success: true}` — before any
    // send had even been attempted. Combined with a `SESService.sendEmail` that
    // returned `false` instead of throwing, an SES outage produced a perfectly
    // successful-looking API response for a code that was never going to
    // arrive, and the user's only feedback was a login form that kept saying
    // "check your email". Waiting for the send costs one SES round trip (a few
    // hundred ms) and makes `success: true` mean what it says.
    //
    // The credentials above are already cached, deliberately: if the send fails
    // the user can retry and the SAME attempt record is reused, and a code that
    // did go out despite a reported failure still verifies.
    const results = await this.eventEmitter.emitAsync('otp.generated', {
      email,
      otp,
      magicLinkToken: magicToken,
      appType,
    });

    // The notification consumer resolves `false` when the send failed (it
    // catches internally — an unhandled rejection out of an event handler would
    // take the process down). No listener at all resolves to an empty array,
    // which is the case in unit tests and in a deployment with notifications
    // disabled; that is not a failure.
    if (results.some((result) => result === false)) {
      this.logger.error(`Could not deliver the login code for ${email}`);
      this.logOtpGenerationError(email, 'Email delivery failed');
      throw new EmailSendFailedException();
    }

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

  async verifyOtpV2(
    verifyOtpDto: VerifyOtpV2Dto,
  ): Promise<AuthenticationResponseDto> {
    const { otp, email, allowedRoles } = verifyOtpDto;
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const testAccounts = this.getTestAccounts();
    if (testAccounts[email]) {
      const cachedOtp = await this.cache.get(this.getOtpKey(email));
      if (!cachedOtp || cachedOtp !== otp) {
        this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
        throw new UnauthorizedException('Invalid OTP');
      }
      return await this.validateUserAndIssueTokens(
        allowedRoles,
        email,
        AuthProvider.EMAIL_OTP,
      );
    }

    const cachedAttempt = await this.cache.get(this.getAuthAttemptKey(email));

    if (!cachedAttempt) {
      this.logVerificationError(
        email,
        'Invalid or expired OTP',
        AuthProvider.EMAIL_OTP,
      );
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const attempt: CachedAuthAttempt = JSON.parse(cachedAttempt);

    if (new Date(attempt.expiresAt) < new Date()) {
      this.logVerificationError(email, 'Expired OTP', AuthProvider.EMAIL_OTP);
      throw new UnauthorizedException('Expired OTP');
    }

    const cachedOtp = await this.cache.get(this.getOtpKey(email));
    if (cachedOtp && cachedOtp !== otp) {
      this.logger.error(`Invalid OTP for email ${email}`);
      this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
      throw new UnauthorizedException('Invalid OTP');
    }

    if (this.hashSecret(otp) !== attempt.otpHash) {
      this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
      throw new UnauthorizedException('Invalid OTP');
    }

    // Mark attempt as used by deleting from cache
    await this.cache.del(this.getAuthAttemptKey(email));
    await this.cache.del(this.getMagicTokenKey(attempt.magicTokenHash));

    if (cachedOtp) {
      await this.cache.del(this.getOtpKey(email));
    }

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.EMAIL_OTP,
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getOtpKey(email: string) {
    return `otp:${email}`;
  }

  private getAuthAttemptKey(email: string) {
    return `auth_attempt:${email}`;
  }

  private getMagicTokenKey(magicTokenHash: string) {
    return `auth_attempt:magic:${magicTokenHash}`;
  }

  async verifyGoogleToken(
    googleSignInDto: GoogleSignInDto,
  ): Promise<GoogleTokenPayload> {
    const { idToken, accessToken } = googleSignInDto;
    if (idToken) {
      return this.verifyGoogleIdToken(idToken);
    }
    if (accessToken) {
      return this.verifyGoogleAccessToken(accessToken);
    }

    throw new BadRequestException('Google token is required');
  }

  async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenPayload> {
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

      if (!payload || !payload.email) {
        throw new UnauthorizedException('Invalid Google token');
      }
      return { email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  async verifyGoogleAccessToken(
    accessToken: string,
  ): Promise<GoogleTokenPayload> {
    try {
      const tokenInfo = await this.googleClient.getTokenInfo(accessToken);

      if (!tokenInfo.email) {
        throw new UnauthorizedException('Invalid Google token');
      }

      return { email: tokenInfo.email };
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  async verifyGoogleUser(
    payload: GoogleTokenPayload,
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

  async verifyAppleToken(
    appleSignInDto: AppleSignInDto,
  ): Promise<AppleTokenPayload> {
    const { identityToken } = appleSignInDto;
    if (!identityToken) {
      throw new BadRequestException('Apple identity token is required');
    }
    return this.verifyAppleIdToken(identityToken);
  }

  async verifyAppleIdToken(identityToken: string): Promise<AppleTokenPayload> {
    const allowedAudiences = this.configService.appleAuth.bundleIds;
    if (!allowedAudiences.length) {
      this.logger.error('APPLE_BUNDLE_IDS is not configured');
      throw new UnauthorizedException('Invalid Apple token');
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(identityToken, this.appleJwks, {
        issuer: AuthService.APPLE_ISSUER,
        audience: allowedAudiences,
      });
      payload = verified.payload;
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) {
      throw new UnauthorizedException('Invalid Apple token');
    }
    return { email };
  }

  async verifyAppleUser(
    payload: AppleTokenPayload,
    allowedRoles: UserRole[],
  ): Promise<AuthenticationResponseDto> {
    const { email } = payload;
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.APPLE,
    );
  }

  private async validateUserAndIssueTokens(
    allowedRoles: UserRole[],
    email: string,
    authProvider: AuthProvider,
  ): Promise<AuthenticationResponseDto> {
    const user = await this.userRepository.findOne({
      where: {
        email: this.normalizeEmail(email),
        status: In([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
      },
    });

    if (!user) {
      this.logger.error(`User not found for email ${email}`);
      this.logVerificationError(email, 'User not found', authProvider);
      throw new NotFoundException(
        'No account found associated with this email',
      );
    }

    const userGroups = await this.groupService.getUserGroupNames(user.id);
    const hasAllowedRoles = allowedRoles.some((role) =>
      userGroups.includes(role),
    );

    if (!hasAllowedRoles) {
      this.logger.error(`User not authorized for email ${user.email}`);
      this.logVerificationError(user.email, 'User not found', authProvider);
      throw new ForbiddenException(
        'This account does not have the required role',
      );
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

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  private generateMagicTokenCredentials(otp: string) {
    const magicToken = crypto.randomBytes(32).toString('hex');
    const otpHash = this.hashSecret(otp);
    const magicTokenHash = this.hashSecret(magicToken);
    const expiresAt = new Date(Date.now() + this.OTP_TTL * 1000);

    return { magicToken, otpHash, magicTokenHash, expiresAt };
  }

  async verifyMagicLink(
    dto: MagicLinkVerifyDto,
  ): Promise<AuthenticationResponseDto> {
    const { token, allowedRoles } = dto;
    const hash = this.hashSecret(token);

    // Reverse-lookup: magic token hash -> email
    const email = await this.cache.get(this.getMagicTokenKey(hash));
    if (!email) {
      this.logger.error('Invalid or expired magic link token');
      this.logVerificationError(
        undefined,
        'Invalid or expired magic link',
        AuthProvider.MAGIC_LINK,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const cachedAttempt = await this.cache.get(this.getAuthAttemptKey(email));
    if (!cachedAttempt) {
      this.logger.error(`No auth attempt found for email ${email}`);
      this.logVerificationError(
        email,
        'Invalid or expired magic link',
        AuthProvider.MAGIC_LINK,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const attempt: CachedAuthAttempt = JSON.parse(cachedAttempt);

    if (new Date(attempt.expiresAt) < new Date()) {
      this.logger.error(`Expired magic link for email ${email}`);
      this.logVerificationError(
        email,
        'Expired magic link',
        AuthProvider.MAGIC_LINK,
      );
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    // Mark attempt as used by deleting from cache
    await this.cache.del(this.getAuthAttemptKey(email));
    await this.cache.del(this.getMagicTokenKey(hash));

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.MAGIC_LINK,
    );
  }
}
