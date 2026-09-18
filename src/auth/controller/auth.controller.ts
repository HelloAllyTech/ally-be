import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import { AuthService } from '../service/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  LoginDto,
  GenerateOtpV2Dto,
  GenerateOtpV2ResponseDto,
  VerifyOtpV2Dto,
  AuthenticationResponseDto,
} from '../dto';
import { JwtRefreshAuthGuard } from '../guards/jwt-refresh-auth.guard';
import { LoggerService } from '../../logger/logger.service';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { RefreshTokenDto } from '../dto/refresh.dto';
import { RateLimit } from '../../rate-limit/decorator/rate-limit.decorator';
import { GoogleSignInDto } from '../dto/google-token.dto';
import { AppleSignInDto } from '../dto/apple-token.dto';
import { MagicLinkVerifyDto } from '../dto/magic-link.dto';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from '../decorators/auth-permissions.decorator';
import { ImpersonateDto } from '../dto/impersonate.dto';
import { PostHog } from 'posthog-node';
import {
  AUTH_ANALYTICS_EVENTS,
  AuthMethod,
  AuthStatus,
} from '../constants/auth-analytics.constants';
import {
  authFailureReasonFrom,
  classifyOtpVerification,
  OtpCheckOutcome,
} from '../util/auth-analytics.util';
import {
  anonymousDistinctId,
  emailDistinctId,
  userDistinctId,
} from 'src/posthog/posthog.util';
import { GoogleTokenPayload } from '../type/auth.types';

@Controller({
  path: 'auth',
  version: '1',
})
@ApiTags('Auth')
export class AuthController {
  private logger = LoggerService.getInstance(AuthController.name);
  constructor(
    private authService: AuthService,
    private permissionsService: PermissionsService,
    private readonly posthog: PostHog,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('generate-otp')
  @Version('2')
  @HttpCode(HttpStatus.OK)
  // @RateLimit({
  //   name: 'otp',
  //   key: 'ip',
  //   errorMessage: 'Too many OTP requests. Please try again later.',
  // })
  async generateOtpV2(
    @Body() generateOtpDto: GenerateOtpV2Dto,
  ): Promise<GenerateOtpV2ResponseDto> {
    const distinctId = emailDistinctId(generateOtpDto.email);
    // "Next" and "Resend code" are the same request, so the per-window counter
    // is what separates the start of an attempt from a resend inside it.
    const attemptNumber = await this.authService.recordOtpRequest(
      generateOtpDto.email,
    );

    if (attemptNumber === 1) {
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.STARTED, {
        method: AuthMethod.EMAIL,
      });
    } else {
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.OTP_RESENT, {
        attempt_number: attemptNumber,
      });
    }

    try {
      return await this.authService.generateOtpV2(generateOtpDto);
    } catch (error) {
      // No code was ever sent, so this attempt ends here rather than at verify:
      // the learner does not get in, which is what auth.completed reports.
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.COMPLETED, {
        method: AuthMethod.EMAIL,
        is_new_user: null,
        status: AuthStatus.FAILED,
        failure_reason: authFailureReasonFrom(error, AuthMethod.EMAIL),
      });
      throw error;
    }
  }

  // @RateLimit({
  //   name: 'otp',
  //   key: 'ip',
  //   errorMessage: 'Too many OTP verification attempts. Please try again later.',
  // })
  @Post('verify-otp')
  @Version('2')
  async verifyOtpV2(
    @Body() verifyOtpDto: VerifyOtpV2Dto,
  ): Promise<AuthenticationResponseDto> {
    const distinctId = emailDistinctId(verifyOtpDto.email);

    try {
      const authentication = await this.authService.verifyOtpV2(verifyOtpDto);
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.OTP_VERIFIED, {
        status: AuthStatus.SUCCESS,
        failure_reason: null,
      });
      await this.captureAuthSucceeded(
        distinctId,
        AuthMethod.EMAIL,
        authentication,
      );
      return authentication;
    } catch (error) {
      // A rejected account is not a rejected code — see classifyOtpVerification.
      const { outcome, failureReason } = classifyOtpVerification(error);
      if (outcome !== OtpCheckOutcome.NOT_CHECKED) {
        this.capture(distinctId, AUTH_ANALYTICS_EVENTS.OTP_VERIFIED, {
          status:
            outcome === OtpCheckOutcome.ACCEPTED
              ? AuthStatus.SUCCESS
              : AuthStatus.FAILED,
          failure_reason: failureReason,
        });
      }
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.COMPLETED, {
        method: AuthMethod.EMAIL,
        is_new_user: null,
        status: AuthStatus.FAILED,
        failure_reason: authFailureReasonFrom(error, AuthMethod.EMAIL),
      });
      throw error;
    }
  }

  @UseGuards(JwtRefreshAuthGuard)
  @Post('refresh')
  @ApiBody({
    type: RefreshTokenDto,
    description: 'Refresh token credentials',
  })
  async refreshTokens(@Req() req: any) {
    const userId = req.user.id;
    const refreshToken = req.user.refreshToken;
    const tokens = await this.authService.refreshTokens(refreshToken, userId);
    if (!tokens) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return {
      ...tokens,
      tokenType: 'bearer',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('impersonate')
  @AuthPermissions([PERMISSIONS.IMPERSONATE_USER])
  @Version('1')
  @HttpCode(HttpStatus.OK)
  async impersonate(@Body() ImpersonateDto: ImpersonateDto) {
    const data = await this.authService.impersonate(ImpersonateDto);
    return { message: data.message, data: data.data };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: { user: { id: string } }) {
    await this.authService.logout(parseInt(req.user.id));
    return { message: 'Logged out successfully' };
  }

  @Post('google')
  async googleAuth(
    @Body() googleSignInDto: GoogleSignInDto,
  ): Promise<AuthenticationResponseDto> {
    // Google starts and finishes an attempt in this one request, and both events
    // have to carry the same distinct id to pair up in the funnel — but the
    // learner's email only exists once the token verifies. So resolve the token
    // first, then report auth.started against whatever identity that yielded.
    let payload: GoogleTokenPayload;
    try {
      payload = await this.authService.verifyGoogleToken(googleSignInDto!);
    } catch (error) {
      const unresolvedDistinctId = anonymousDistinctId();
      this.capture(unresolvedDistinctId, AUTH_ANALYTICS_EVENTS.STARTED, {
        method: AuthMethod.GOOGLE_OAUTH,
      });
      this.capture(unresolvedDistinctId, AUTH_ANALYTICS_EVENTS.COMPLETED, {
        method: AuthMethod.GOOGLE_OAUTH,
        is_new_user: null,
        status: AuthStatus.FAILED,
        failure_reason: authFailureReasonFrom(error, AuthMethod.GOOGLE_OAUTH),
      });
      throw error;
    }

    const distinctId = payload.email
      ? emailDistinctId(payload.email)
      : anonymousDistinctId();
    this.capture(distinctId, AUTH_ANALYTICS_EVENTS.STARTED, {
      method: AuthMethod.GOOGLE_OAUTH,
    });

    try {
      const authentication = await this.authService.verifyGoogleUser(
        payload,
        googleSignInDto.allowedRoles,
      );
      await this.captureAuthSucceeded(
        distinctId,
        AuthMethod.GOOGLE_OAUTH,
        authentication,
      );
      return authentication;
    } catch (error) {
      this.capture(distinctId, AUTH_ANALYTICS_EVENTS.COMPLETED, {
        method: AuthMethod.GOOGLE_OAUTH,
        is_new_user: null,
        status: AuthStatus.FAILED,
        failure_reason: authFailureReasonFrom(error, AuthMethod.GOOGLE_OAUTH),
      });
      throw error;
    }
  }

  @Post('apple')
  async appleAuth(
    @Body() appleSignInDto: AppleSignInDto,
  ): Promise<AuthenticationResponseDto> {
    const payload = await this.authService.verifyAppleToken(appleSignInDto);
    return this.authService.verifyAppleUser(
      payload,
      appleSignInDto.allowedRoles,
    );
  }

  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage:
      'Too many magic link verification attempts. Please try again later.',
  })
  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMagicLink(@Body() dto: MagicLinkVerifyDto) {
    return this.authService.verifyMagicLink(dto);
  }

  /**
   * Report a login that issued tokens, and merge the pre-login identity into the
   * learner's user id so the funnel and everything the app captures afterwards
   * land on one PostHog person.
   *
   * Wholly guarded: this runs after the tokens exist, and neither an analytics
   * failure nor the extra `is_first_time` read may turn a successful login into
   * a 500.
   */
  private async captureAuthSucceeded(
    preLoginDistinctId: string,
    method: AuthMethod,
    authentication: AuthenticationResponseDto,
  ): Promise<void> {
    try {
      const isNewUser = await this.authService.isFirstTimeUser(
        authentication.user.id,
      );
      this.capture(preLoginDistinctId, AUTH_ANALYTICS_EVENTS.COMPLETED, {
        method,
        is_new_user: isNewUser,
        status: AuthStatus.SUCCESS,
        failure_reason: null,
      });
      this.posthog.alias({
        distinctId: userDistinctId(authentication.user.id),
        alias: preLoginDistinctId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to report a successful login to PostHog',
        error,
      );
    }
  }

  /**
   * Analytics must never be able to fail an authentication request. `capture`
   * only queues in memory, but a misconfigured client can still throw
   * synchronously, and losing an event beats losing a login.
   */
  private capture(
    distinctId: string,
    event: string,
    properties: Record<string, unknown>,
  ): void {
    try {
      this.posthog.capture({ distinctId, event, properties });
    } catch (error) {
      this.logger.error(`Failed to capture ${event} in PostHog`, error);
    }
  }
}
