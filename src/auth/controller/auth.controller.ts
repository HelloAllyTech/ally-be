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
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from '../service/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { GenerateOtpDto, LoginDto, VerifyOtpDto } from '../dto';
import { UserCreateDto } from '../dto/user-create.dto';
import { JwtRefreshAuthGuard } from '../guards/jwt-refresh-auth.guard';
import { LoggerService } from '../../logger/logger.service';
import { ApiBody } from '@nestjs/swagger';
import { RefreshTokenDto } from '../dto/refresh.dto';
import { UserRole } from '../../common/constants/user.constants';
import { AuthRoles } from '../decorators/auth-roles.decorator';

@Controller('v1/auth')
export class AuthController {
  private logger = LoggerService.getInstance(AuthController.name);
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('generate-otp')
  @HttpCode(HttpStatus.OK)
  async generateOtp(@Body() generateOtpDto: GenerateOtpDto) {
    return this.authService.generateOtp(
      generateOtpDto.phone,
      generateOtpDto.email,
    );
  }

  @Post('verify-otp')
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(
      verifyOtpDto.otp,
      verifyOtpDto.phone,
      verifyOtpDto.email,
    );
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @AuthRoles(UserRole.SUPER_ADMIN)
  async signup(@Body() userData: UserCreateDto) {
    try {
      const user = await this.authService.signup(userData);
      return {
        message: 'User created successfully',
        user,
      };
    } catch (error) {
      this.logger.error(error.message);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Could not create user');
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
  @Post('logout')
  async logout(@Req() req: { user: { id: string } }) {
    await this.authService.logout(parseInt(req.user.id));
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  async getPermissions(@Req() req: { user: { id: string } }) {
    return await this.authService.getUserPermissions(parseInt(req.user.id));
  }
}
