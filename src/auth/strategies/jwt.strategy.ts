import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { PermissionsService } from '../../authorization/service/permissions.service';
import { LastActiveService } from '../service/last-active.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  logger = LoggerService.getInstance(JwtStrategy.name);
  constructor(
    configService: AppConfigService,
    private permissionsService: PermissionsService,
    private lastActiveService: LastActiveService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwt.accessToken.secret || '',
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

    // Fire-and-forget: must never add latency to the auth path or fail auth.
    void this.lastActiveService.touch(user.id);

    // Check if user has system admin access (can operate without tenant)
    // Removed tenantId validation for non-system admin users.
    // This allows tokens with null/undefined tenantId to pass JwtStrategy validation.
    // Downstream authorization guards or services should handle the missing tenantId
    // to provide more granular error messages or fallback behavior.
    return user;
  }
}
