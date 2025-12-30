import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { PermissionsService } from '../../authorization/service/permissions.service';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  logger = LoggerService.getInstance(JwtStrategy.name);
  constructor(
    configService: AppConfigService,
    private permissionsService: PermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwt.accessToken.secret,
      expiresIn: configService.jwt.accessToken.expiresIn,
    });
  }

  async validate(payload: any) {
    this.logger.info('JwtStrategy validate called');

    const user = {
      id: parseInt(payload.sub),
      username: payload.username,
      tenantId: payload.tenantId,
    };

    // Set the execution context with user information
    ExecutionManager.setAuthContext(user.id.toString(), user.tenantId);

    // Check if user has system admin access (can operate without tenant)
    const userPermissions = await this.permissionsService.getUserPermissions(
      user.id,
    );
    const hasSystemAdminAccess = userPermissions.includes(
      PERMISSIONS.SYSTEM_ACCESS,
    );

    if (!hasSystemAdminAccess && !user.tenantId) {
      throw new UnauthorizedException('Tenant ID is required');
    }
    return user;
  }
}
