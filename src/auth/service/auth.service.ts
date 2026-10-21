import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository, MoreThan, In, Brackets } from 'typeorm';
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
import {
  OtpRateLimitedException,
  UserSuspendedException,
} from '../exception/login.exception';
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
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { Impersonate } from '../interface/impersonate.interface';
import {
  describeWait,
  OTP_LIMIT_MESSAGES,
  OTP_LIMITS,
} from '../constants/otp-limits.constants';

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

  /** A Google OAuth client id is `<project number>-<suffix>.apps.googleusercontent.com`. */
  private static googleProjectNumber(clientId: string): string | undefined {
    return /^(\d+)-[\w-]+\.apps\.googleusercontent\.com$/.exec(clientId)?.[1];
  }

  constructor(
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: AppConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
    private readonly groupService: GroupService,
    private permissionsService: PermissionsService,
    private readonly tenantScopeService: TenantScopeService,
  ) {
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.OTP_TTL = +this.configService.otp.ttl;
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID!);
  }

  async validateRefreshToken(refreshToken: string, userId: number) {
    const token = await this.findRefreshTokenRow(refreshToken, userId);
    if (!token) {
      throw new UnauthorizedException();
    }

    const user = await this.userRepository.findOneOrFail({
      where: { id: userId },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;
    return result;
  }

  async impersonate(ImpersonateData: Impersonate, callerId: number) {
    // PLATFORM_ADMIN carries impersonate:user, allowlisted or not. An
    // organization allowlist cannot bound it: the session minted here carries
    // the target's reach, not the caller's, so an admin confined to some orgs
    // could take over any account on the platform — including an
    // unrestricted admin's. Allowlisted admins don't impersonate at all.
    if (await this.tenantScopeService.isRestricted(callerId)) {
      throw new ForbiddenException(
        'Organization-restricted admins cannot impersonate users',
      );
    }

    const userEmail = ImpersonateData.email;

    const user = await this.userRepository.findOne({
      where: { email: userEmail, status: UserStatus.ACTIVE },
      select: ['id', 'username', 'tenantId'],
    });
    if (!user) {
      throw new NotFoundException('No active user with that email');
    }

    const isMultitenantAdmin = await this.permissionsService.isMultiTenantAdmin(
      user.id,
    );

    if (isMultitenantAdmin)
      return { message: 'Multi-tenant admin cannot be impersonated.' };

    const tokens = await this.generateTokens(user);

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.SUPER_ADMIN_IMPERSONATE,
      details: {
        purpose: 'Super admin impersonated a user',
        impersonatedBy: callerId,
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
      // `jti` makes every refresh token unique — two signed in the same
      // second would otherwise be identical — and marks it as one whose row
      // is an exact SHA-256 (see findRefreshTokenRow).
      this.jwtService.signAsync(
        { ...payload, jti: crypto.randomUUID() },
        {
          expiresIn: this.configService.jwt.refreshToken.expiresIn as any,
          secret: this.configService.jwt.refreshToken.secret,
        },
      ),
    ]);

    // Calculate expiry date based on config
    const ttlDays = this.configService.jwt.refreshToken.ttlDays;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.pruneDeadRefreshTokens(user.id);
    await this.refreshTokenRepository.save({
      token: AuthService.hashRefreshToken(refreshToken),
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
    const tokenEntity = await this.findRefreshTokenRow(oldRefreshToken, userId);
    if (!tokenEntity) {
      throw new UnauthorizedException();
    }

    if (AuthService.isLegacyRefreshTokenRow(tokenEntity)) {
      // Pre-rotation session: keep its old behaviour until it expires.
      await this.refreshTokenRepository.remove(tokenEntity);
    } else if (!tokenEntity.rotatedAt) {
      // Stamp rather than delete, so a concurrent refresh of the same token
      // (a second tab, the phone) still succeeds inside the grace window.
      await this.refreshTokenRepository.update(
        { id: tokenEntity.id },
        { rotatedAt: new Date() },
      );
    }

    return this.generateTokens(user);
  }

  /**
   * How long an exchanged refresh token may be exchanged again. The web client
   * refreshes per tab, and the mobile app can race the web app, so two
   * refreshes of one token can land within moments of each other; the loser
   * must not be logged out. Past this window reuse is refused.
   */
  static readonly REFRESH_TOKEN_REUSE_GRACE_MS = 30_000;

  static hashRefreshToken(refreshToken: string): string {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
  }

  /** Rows from before exact rotation hold a bcrypt hash, not a SHA-256. */
  private static isLegacyRefreshTokenRow(row: RefreshToken): boolean {
    return row.token.startsWith('$2');
  }

  /**
   * The stored row this exact refresh token was issued as, or null when it
   * must be refused (unknown, expired, or rotated longer ago than the grace).
   *
   * Tokens carrying a `jti` are matched exactly by SHA-256 and nothing else.
   * They must never fall through to the bcrypt rows: bcrypt reads only 72
   * bytes, which every token of a user shares, so a bcrypt compare would
   * accept any of that user's tokens — the defect this replaces. Tokens
   * without a `jti` predate the change and keep the legacy match until their
   * rows expire.
   */
  private async findRefreshTokenRow(
    refreshToken: string,
    userId: number,
  ): Promise<RefreshToken | null> {
    const now = new Date();
    const decoded = this.jwtService.decode(refreshToken) as {
      jti?: string;
    } | null;

    if (decoded?.jti) {
      const row = await this.refreshTokenRepository.findOne({
        where: {
          userId,
          token: AuthService.hashRefreshToken(refreshToken),
          expiresAt: MoreThan(now),
        },
      });
      if (!row) return null;
      if (
        row.rotatedAt &&
        now.getTime() - new Date(row.rotatedAt).getTime() >
          AuthService.REFRESH_TOKEN_REUSE_GRACE_MS
      ) {
        this.logger.warn(
          `Refused reuse of a rotated refresh token for user ${userId}`,
        );
        return null;
      }
      return row;
    }

    const legacy = await this.refreshTokenRepository
      .createQueryBuilder('rt')
      .where('rt.userId = :userId', { userId })
      .andWhere('rt.expiresAt > :now', { now })
      .andWhere('rt.token LIKE :bcryptPrefix', { bcryptPrefix: '$2%' })
      .getOne();
    if (!legacy || !(await bcrypt.compare(refreshToken, legacy.token))) {
      return null;
    }
    return legacy;
  }

  /**
   * Drops rows that can never authenticate again: expired, or rotated and past
   * the reuse grace. Without this every login and refresh left a row behind.
   */
  private async pruneDeadRefreshTokens(userId: number): Promise<void> {
    const graceCutoff = new Date(
      Date.now() - AuthService.REFRESH_TOKEN_REUSE_GRACE_MS,
    );
    await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('"userId" = :userId', { userId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('"expiresAt" < :now', { now: new Date() }).orWhere(
            '"rotatedAt" < :graceCutoff',
            { graceCutoff },
          );
        }),
      )
      .execute();
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

  /**
   * The fixed code for a test account, matched on the normalised address like
   * every login-code key. Matched as typed, a capitalised spelling of a test
   * address would take the real-account path and overwrite the fixed code
   * stored under the normalised one.
   */
  private getTestAccountOtp(email: string): string | undefined {
    const normalizedEmail = this.normalizeEmail(email);
    const match = Object.entries(this.getTestAccounts()).find(
      ([address]) => this.normalizeEmail(address) === normalizedEmail,
    );
    return match?.[1];
  }

  private async handleTestAccountOtp(email: string) {
    const otp = this.getTestAccountOtp(email);
    if (otp) {
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
    // Before the account lookup, so an unknown address is limited exactly like
    // a known one. Test accounts are exempt: no email is sent for them, and
    // their fixed code is still covered by the daily guess limit at verify.
    if (!this.getTestAccountOtp(email)) {
      await this.reserveCodeRequest(email);
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

    // The previous code and its link stop working, and the new code starts
    // with a full set of guesses.
    await this.destroyOtp(email);

    const isTestAccount = await this.handleTestAccountOtp(email);
    if (isTestAccount) {
      return { success: true, expiresIn: this.OTP_TTL };
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

    if (this.getTestAccountOtp(email)) {
      const cachedOtp = await this.cache.get(this.getOtpKey(email));
      if (!cachedOtp) {
        this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
        throw new UnauthorizedException('Invalid OTP');
      }
      const guessesOnThisCode = await this.spendOtpGuess(email);
      if (cachedOtp !== otp) {
        return this.rejectWrongOtp(email, guessesOnThisCode);
      }
      await this.clearOtpGuesses(email);
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

    // Spent before the comparison, never after: concurrent requests each take
    // their own slot, so firing guesses in parallel buys no extra ones.
    const guessesOnThisCode = await this.spendOtpGuess(email);

    const cachedOtp = await this.cache.get(this.getOtpKey(email));
    if (cachedOtp && cachedOtp !== otp) {
      this.logger.error(`Invalid OTP for email ${email}`);
      return this.rejectWrongOtp(email, guessesOnThisCode);
    }

    if (this.hashSecret(otp) !== attempt.otpHash) {
      return this.rejectWrongOtp(email, guessesOnThisCode);
    }

    // Mark attempt as used by deleting from cache
    await this.cache.del(this.getAuthAttemptKey(email));
    await this.cache.del(this.getMagicTokenKey(attempt.magicTokenHash));

    if (cachedOtp) {
      await this.cache.del(this.getOtpKey(email));
    }
    await this.clearOtpGuesses(email);

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.EMAIL_OTP,
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  // Every per-address key below is built from the normalised address, so one
  // account has one code and one set of counters however its address is typed.

  private getOtpKey(email: string) {
    return `otp:${this.normalizeEmail(email)}`;
  }

  private getOtpRequestCountKey(email: string) {
    return `otp_requests:${this.normalizeEmail(email)}`;
  }

  private getOtpGuessKey(email: string) {
    return `otp_guesses:${this.normalizeEmail(email)}`;
  }

  private getOtpDailyGuessKey(email: string) {
    return `otp_guesses_day:${this.normalizeEmail(email)}`;
  }

  private getOtpCodeRequestKey(email: string) {
    return `otp_code_requests:${this.normalizeEmail(email)}`;
  }

  /** Counts this request against the address's code-request window; refuses past the limit. */
  private async reserveCodeRequest(email: string): Promise<void> {
    const window = await this.cache.incrWithExpiry(
      this.getOtpCodeRequestKey(email),
      OTP_LIMITS.CODE_WINDOW_SECONDS,
    );
    if (window.count > OTP_LIMITS.MAX_CODES_PER_WINDOW) {
      this.logOtpGenerationError(email, 'Too many codes requested');
      throw new OtpRateLimitedException(
        OTP_LIMIT_MESSAGES.generateRequest(describeWait(window.ttlSeconds)),
        window.ttlSeconds,
      );
    }
  }

  /**
   * Spends one check of a code, against both the address's daily allowance and
   * the code's own, and returns how many checks this code has now had. Refuses
   * when either is used up; a code past its allowance is destroyed.
   */
  private async spendOtpGuess(email: string): Promise<number> {
    const today = await this.cache.incrWithExpiry(
      this.getOtpDailyGuessKey(email),
      OTP_LIMITS.GUESS_DAY_SECONDS,
    );
    if (today.count > OTP_LIMITS.MAX_GUESSES_PER_DAY) {
      this.logVerificationError(
        email,
        'Daily OTP guess limit reached',
        AuthProvider.EMAIL_OTP,
      );
      throw new OtpRateLimitedException(
        OTP_LIMIT_MESSAGES.dailyGuesses(describeWait(today.ttlSeconds)),
        today.ttlSeconds,
      );
    }

    const thisCode = await this.cache.incrWithExpiry(
      this.getOtpGuessKey(email),
      this.OTP_TTL,
    );
    if (thisCode.count > OTP_LIMITS.MAX_GUESSES_PER_CODE) {
      return this.rejectWrongOtp(email, thisCode.count);
    }
    return thisCode.count;
  }

  /**
   * Refuses a wrong code. The check that uses up a code's allowance destroys
   * it there and then, and says so, rather than leaving the learner to type
   * another code into a dead one.
   */
  private async rejectWrongOtp(
    email: string,
    guessesOnThisCode: number,
  ): Promise<never> {
    if (guessesOnThisCode >= OTP_LIMITS.MAX_GUESSES_PER_CODE) {
      await this.destroyOtp(email);
      this.logVerificationError(
        email,
        'Too many incorrect OTPs',
        AuthProvider.EMAIL_OTP,
      );
      throw new UnauthorizedException(OTP_LIMIT_MESSAGES.CODE_LOCKED);
    }
    this.logVerificationError(email, 'Invalid OTP', AuthProvider.EMAIL_OTP);
    throw new UnauthorizedException('Invalid OTP');
  }

  /** Deletes the address's current code, its sign-in link and its guess count. */
  private async destroyOtp(email: string): Promise<void> {
    const cachedAttempt = await this.cache.get(this.getAuthAttemptKey(email));
    if (cachedAttempt) {
      const parsed: CachedAuthAttempt = JSON.parse(cachedAttempt);
      await this.cache.del(this.getMagicTokenKey(parsed.magicTokenHash));
    }
    await this.cache.del(this.getAuthAttemptKey(email));
    await this.cache.del(this.getOtpKey(email));
    await this.cache.del(this.getOtpGuessKey(email));
  }

  /** After a successful sign-in, which proves the learner holds the inbox. */
  private async clearOtpGuesses(email: string): Promise<void> {
    await this.cache.del(this.getOtpGuessKey(email));
    await this.cache.del(this.getOtpDailyGuessKey(email));
  }

  /**
   * Counts OTP requests for one email inside a single OTP window and returns
   * this request's number: 1 for the first "Next" tap, 2+ for every "Resend
   * code" after it. Analytics only — nothing gates on it.
   *
   * The client sends the same request for both buttons, so the counter is the
   * only signal we have for telling them apart. It carries the OTP TTL, so a
   * learner who comes back after the code has expired starts a fresh attempt at
   * 1. Caveat: a request that fails (unknown account, wrong role) still counts,
   * so retrying the same address immediately reads as a resend even though no
   * code was ever sent.
   */
  async recordOtpRequest(email: string): Promise<number> {
    const key = this.getOtpRequestCountKey(email);
    const attemptNumber = await this.cache.incr(key);
    if (attemptNumber === 1) {
      await this.cache.expire(key, this.OTP_TTL);
    }
    return attemptNumber;
  }

  /**
   * True when this is the learner's first successful login, for
   * `auth.completed`'s `is_new_user`.
   *
   * There is no signup endpoint — every account is provisioned before anyone
   * can log in — and `users` has no first-login column, so the closest proxy is
   * the Terms & Agreement flag: the app forces acceptance on the very first
   * sign-in, and this runs before that happens.
   *
   * Takes the just-issued access token rather than a bare id: `id` is a global
   * PK today so the lookup can't cross tenants regardless, but decoding
   * `tenantId` from the same token that carries the id (see `generateTokens`)
   * and filtering on it keeps this call from becoming an "idiomatic" untenanted
   * lookup that a future, less-trustworthy caller could copy.
   */
  async isFirstTimeUser(accessToken: string): Promise<boolean> {
    const payload = this.jwtService.decode(accessToken) as {
      sub?: number;
      tenantId?: string;
    } | null;
    if (!payload?.sub) return false;

    const user = await this.userRepository.findOne({
      where: { id: payload.sub, tenantId: payload.tenantId },
      select: { id: true, termsAndAgreementApproved: true },
    });
    return user ? !user.termsAndAgreementApproved : false;
  }

  private getAuthAttemptKey(email: string) {
    return `auth_attempt:${this.normalizeEmail(email)}`;
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
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.googleAuth.clientIds,
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

  /**
   * Google describes an access token issued to any OAuth client, so a valid
   * token only proves who the user is when it was issued to one of Ally's own
   * clients: one of the configured ids or, failing that, another client in the
   * same Google Cloud project. The fallback is there because nothing makes the
   * web apps' client id appear in the server's list, and only Ally can create
   * clients in its own project.
   */
  async verifyGoogleAccessToken(
    accessToken: string,
  ): Promise<GoogleTokenPayload> {
    try {
      const tokenInfo = await this.googleClient.getTokenInfo(accessToken);

      const { clientIds } = this.configService.googleAuth;
      const issuedTo = [tokenInfo.aud, tokenInfo.azp].filter(
        (id): id is string => !!id,
      );
      if (!issuedTo.some((id) => clientIds.includes(id))) {
        const ownProjects = new Set(
          clientIds.map(AuthService.googleProjectNumber).filter(Boolean),
        );
        const sameProjectClient = issuedTo.find((id) =>
          ownProjects.has(AuthService.googleProjectNumber(id)),
        );
        // Client ids aren't personal data. Logged so an unlisted client,
        // ours or not, shows up straight away.
        if (!sameProjectClient) {
          this.logger.warn(
            `Rejected a Google access token issued to client ${issuedTo[0] ?? 'unknown'}`,
          );
          throw new UnauthorizedException('Invalid Google token');
        }
        this.logger.warn(
          `Accepted a Google access token from unlisted client ${sameProjectClient} in Ally's Google project; add it to GOOGLE_WEB_CLIENT_ID`,
        );
      }

      // The typings say boolean, but tokeninfo returns every field as a
      // string, so a verified address arrives as 'true'.
      if (!tokenInfo.email || String(tokenInfo.email_verified) !== 'true') {
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
    await this.clearOtpGuesses(email);

    return await this.validateUserAndIssueTokens(
      allowedRoles,
      email,
      AuthProvider.MAGIC_LINK,
    );
  }
}
