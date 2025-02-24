import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto';
import { UserCreateDto } from './dto/user-create.dto';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { LoggerService } from '../logger/logger.service';
@Controller('v1/auth')
export class AuthController {
  private logger = LoggerService.getInstance(AuthController.name);
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
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
  async refreshTokens(@Req() req: any) {
    const userId = req.user.id;
    const refreshToken = req.user.refreshToken;
    const tokens = await this.authService.refreshTokens(refreshToken, userId);
    if (!tokens) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: 'bearer',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: { user: { id: string } }) {
    await this.authService.logout(parseInt(req.user.id));
    return { message: 'Logged out successfully' };
  }
}
