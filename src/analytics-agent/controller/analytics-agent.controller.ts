import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { SUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';
import {
  AnalyticsAgentCatalogResponseDto,
  AskAnalyticsAgentDto,
  AskAnalyticsAgentResponseDto,
} from '../dto/analytics-agent.dto';
import { AnalyticsAgentService } from '../service/analytics-agent.service';

/**
 * The Analytics Agent's HTTP surface — two endpoints, gated on
 * SUPER_ADMIN_ROLES, the same tier as the rest of `/v1/analytics`.
 *
 * This used to sit on the elevated SUPER_DUPER_ADMIN_ROLES tier: every other
 * endpoint on that controller answers one fixed, reviewed question, while this
 * one answers whatever question the reader types, across every allowlisted
 * table, at platform scope. That reasoning still holds as a general principle
 * (broader capability warrants a stricter gate), but the product decision was
 * made to give every admin tier parity across all analytics surfaces instead.
 * What makes that safe here is `analytics-agent.constants.ts`'s ALLOWED_TABLES:
 * every tenant-attributable table it names is a filtered view that already
 * excludes test-tenant rows structurally, so widening who can ask a question
 * does not widen what the question can see.
 */
@ApiTags('Analytics Agent')
@Controller('v1/analytics/agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsAgentController {
  constructor(private readonly analyticsAgentService: AnalyticsAgentService) {}

  @Post('ask')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Ask an analytics question in English',
    description:
      'Turns the question into one read-only SELECT over an allowlisted subset of ' +
      'the schema, runs it inside a READ ONLY transaction with a statement timeout ' +
      'and a row cap, and returns the rows plus a narrated answer, caveats and an ' +
      'optional chart specification.\n\n' +
      'The response always says which of five things happened (`outcome`): the ' +
      'question was answered, it needs clarifying, it cannot be answered from the ' +
      'readable tables, the generated SQL was refused by the guard, or the query ' +
      'failed to run. The SQL is returned whenever one was generated — including ' +
      'when it was refused — because a number nobody can audit is not an answer.\n\n' +
      'Stateless: pass prior turns in `history` for follow-up questions. There is ' +
      'no server-side conversation, so resetting the chat is a client-side act.',
  })
  @ApiResponse({
    status: 200,
    description: 'The turn was processed (see `outcome` for what happened)',
    type: AskAnalyticsAgentResponseDto,
  })
  async ask(
    @Body() body: AskAnalyticsAgentDto,
    @Req() req: { user: { id: number } },
  ): Promise<AskAnalyticsAgentResponseDto> {
    return this.analyticsAgentService.ask(body, req.user?.id);
  }

  @Get('catalog')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_AGENT, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Tables and columns the agent can read',
    description:
      'The readable catalogue, so the UI can tell a reader what is in scope ' +
      'before they ask — and state the columns that are never readable, rather ' +
      'than leaving that policy to be discovered by being refused.',
  })
  @ApiResponse({
    status: 200,
    description: 'Catalogue retrieved successfully',
    type: AnalyticsAgentCatalogResponseDto,
  })
  async getCatalog(): Promise<AnalyticsAgentCatalogResponseDto> {
    return this.analyticsAgentService.getCatalog();
  }
}
