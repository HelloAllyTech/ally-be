import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import { AuthService } from '../service/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  GenerateOtpDto,
  LoginDto,
  VerifyOtpDto,
  GenerateOtpV2Dto,
  GenerateOtpV2ResponseDto,
  VerifyOtpV2Dto,
  VerifyOtpV2ResponseDto,
} from '../dto';
import { JwtRefreshAuthGuard } from '../guards/jwt-refresh-auth.guard';
import { LoggerService } from '../../logger/logger.service';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { RefreshTokenDto } from '../dto/refresh.dto';
import { RateLimit } from '../../rate-limit/decorator/rate-limit.decorator';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { GoogleIdTokenDto } from '../dto/google-token.dto';

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
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('generate-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage: 'Too many OTP requests. Please try again later.',
  })
  async generateOtp(@Body() generateOtpDto: GenerateOtpDto) {
    return this.authService.generateOtp(
      generateOtpDto.phone,
      generateOtpDto.email,
    );
  }

  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage: 'Too many OTP verification attempts. Please try again later.',
  })
  @Post('verify-otp')
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(
      verifyOtpDto.otp,
      verifyOtpDto.phone,
      verifyOtpDto.email,
    );
  }

  @Post('generate-otp')
  @Version('2')
  @HttpCode(HttpStatus.OK)
  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage: 'Too many OTP requests. Please try again later.',
  })
  async generateOtpV2(
    @Body() generateOtpDto: GenerateOtpV2Dto,
  ): Promise<GenerateOtpV2ResponseDto> {
    return this.authService.generateOtpV2(generateOtpDto);
  }

  @RateLimit({
    name: 'otp',
    key: 'ip',
    errorMessage: 'Too many OTP verification attempts. Please try again later.',
  })
  @Post('verify-otp')
  @Version('2')
  async verifyOtpV2(
    @Body() verifyOtpDto: VerifyOtpV2Dto,
  ): Promise<VerifyOtpV2ResponseDto> {
    return this.authService.verifyOtpV2(verifyOtpDto);
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
  @Post('logout')
  async logout(@Req() req: { user: { id: string } }) {
    await this.authService.logout(parseInt(req.user.id));
    return { message: 'Logged out successfully' };
  }

  // TO Do: Remove this endpoint after app force update
  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  async getPermissions(@Req() req: { user: { id: string } }) {
    return await this.permissionsService.getUserPermissions(
      parseInt(req.user.id),
    );
  }

  @Post('google')
  async googleAuth(
    @Body() googleIdTokenDto: GoogleIdTokenDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.authService.verifyGoogleIdToken(
      googleIdTokenDto.idToken,
    );
    const user = await this.authService.findGoogleUser(payload);

    return this.authService.generateTokens(user);
  }
}
