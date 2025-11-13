import { Global, Module } from '@nestjs/common';
import { AuthService } from './service/auth.service';
import { AuthController } from './controller/auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { PermissionsGuard } from './guards/permissions.guard';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [
    JwtModule.register({}), // Empty config since we're using different configs for access and refresh tokens
    ConfigModule,
  ],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy, PermissionsGuard],
  controllers: [AuthController],
  exports: [AuthService, PermissionsGuard],
})
export class AuthModule {}
