import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';
import { CreateHelplineSessionDto } from '../dto/helpline.dto';
import { HelplineSessionService } from '../service/helpline-session.service';
import {
  GuestSessionCreatedDto,
  PublicStatusDto,
} from '../type/helpline.types';

/** Session starts per client address per hour (contract §5.1). */
export const HELPLINE_SESSION_RATE_LIMIT = {
  LIMIT: 5,
  TTL_MS: 3_600_000,
  MESSAGE:
    'Too many chats were started from this connection. Please try again later.',
} as const;

/**
 * The talker page's unauthenticated endpoints. No guard on purpose — and so
 * nothing here may return anything about a talker or a chat beyond what the
 * caller just created.
 */
@ApiTags('Text helpline — public')
@Controller({ path: 'helpline/public', version: '1' })
export class HelplinePublicController {
  constructor(private readonly sessions: HelplineSessionService) {}

  @Get(':tenantCode/status')
  @ApiOperation({
    summary:
      'Whether the helpline is open, and what the talker page needs to show',
  })
  status(@Param('tenantCode') tenantCode: string): Promise<PublicStatusDto> {
    return this.sessions.status(tenantCode);
  }

  // `name` is left at `default`: this route's own 5/hour replaces the default
  // throttler's numbers here, and the otp throttler is for login codes only.
  @RateLimit({
    key: 'ip',
    limit: HELPLINE_SESSION_RATE_LIMIT.LIMIT,
    ttl: HELPLINE_SESSION_RATE_LIMIT.TTL_MS,
    errorMessage: HELPLINE_SESSION_RATE_LIMIT.MESSAGE,
  })
  @Post(':tenantCode/session')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Accept consent and join the queue' })
  createSession(
    @Param('tenantCode') tenantCode: string,
    @Body() body: CreateHelplineSessionDto,
    @Req() request: Request,
  ): Promise<GuestSessionCreatedDto> {
    const userAgent = request.headers['user-agent'];
    return this.sessions.createSession(tenantCode, {
      ...body,
      ip: request.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }
}
