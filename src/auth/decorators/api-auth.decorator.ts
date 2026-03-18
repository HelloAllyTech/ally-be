import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiAuthGuard } from '../guards/api-auth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

export function ApiServiceAuthGuard() {
  return applyDecorators(UseGuards(ApiAuthGuard, JwtAuthGuard));
}
