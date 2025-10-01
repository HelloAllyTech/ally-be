import { Global, Module } from '@nestjs/common';
import { AuthService } from './service/auth.service';
import { AuthController } from './controller/auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionValidator } from './service/permission-validator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { RefreshToken } from '../common/entities/refresh-token.entity';
import { User } from '../common/entities/user.entity';

@Global()
@Module({
  imports: [
    JwtModule.register({}), // Empty config since we're using different configs for access and refresh tokens
    TypeOrmModule.forFeature([User, RefreshToken]),
    ConfigModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    PermissionsGuard,
    PermissionValidator,
  ],
  controllers: [AuthController],
  exports: [AuthService, PermissionsGuard, PermissionValidator],
})
export class AuthModule {}
