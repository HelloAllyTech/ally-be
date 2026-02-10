import { applyDecorators, UseGuards } from '@nestjs/common';
import { AiApiKeyGuard } from '../guards/ai-auth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

export function AiServiceAuthGuard() {
  return applyDecorators(UseGuards(AiApiKeyGuard, JwtAuthGuard));
}
