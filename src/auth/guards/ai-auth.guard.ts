import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';

// Custom API Key Guard for AI service
@Injectable()
export class AiApiKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || apiKey !== this.config.ai.apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
