import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  logger = LoggerService.getInstance(JwtStrategy.name);
  constructor(configService: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwt.accessToken.secret,
    });
  }

  async validate(payload: any) {
    this.logger.info('JwtStrategy validate called');
    return {
      id: parseInt(payload.sub),
      username: payload.username,
      role: payload.role,
    };
  }
}
