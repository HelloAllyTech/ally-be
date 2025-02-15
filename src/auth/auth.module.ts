import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RefreshToken } from '../common/entities/refresh-token.entity';
import { User } from '../common/entities/user.entity';

@Module({
  imports: [
    JwtModule.register({}), // Empty config since we're using different configs for access and refresh tokens
    TypeOrmModule.forFeature([User, RefreshToken]),
    ConfigModule,
  ],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
