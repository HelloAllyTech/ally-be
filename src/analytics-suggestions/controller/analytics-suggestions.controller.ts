import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

import {
  AcceptSuggestionDto,
  AcceptSuggestionResponseDto,
  GenerateSuggestionsDto,
  GenerateSuggestionsResponseDto,
  ListSuggestionsQueryDto,
  ListSuggestionsResponseDto,
  RejectSuggestionDto,
  SuggestionDto,
} from '../dto/analytics-suggestion.dto';
import { AnalyticsSuggestionStatus } from '../enum/analytics-suggestion.enum';
import { AnalyticsSuggestionsService } from '../service/analytics-suggestions.service';

/**
 * The Suggestions queue's HTTP surface — four endpoints, gated on
 * SUPER_ADMIN_ROLES, the same tier as the rest of `/v1/analytics`.
 *
 * This used to sit on the elevated SUPER_DUPER_ADMIN_ROLES tier: the other
 * endpoints answer fixed, reviewed questions, while this one reads the whole
 * platform at once and files onto the product roadmap, and accepting a
 * suggestion is a write into another team's backlog rather than reading a
 * chart. That reasoning still holds as a general principle, but the product
 * decision was made to give every admin tier parity across all analytics
 * surfaces instead.
 *
 * No new permission constant: the gate is a role tier, so there is no
 * `permissions` row to grant and no Redis permission cache to bust on deploy.
 */
@ApiTags('Analytics Suggestions')
@Controller('v1/analytics/suggestions')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsSuggestionsController {
  constructor(
    private readonly suggestionsService: AnalyticsSuggestionsService,
  ) {}

  @Post('generate')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_SUGGESTIONS)
  @ApiOperation({
    summary: 'Generate product suggestions from an analytics window',
    description:
      'Reads fifteen platform analytics sections for the chosen window, sends them ' +
      "to the model with Ally's product-vision context, the live product goals, the " +
      'existing roadmap and every previous decision, and stores what survives ' +
      'validation as a new batch of pending suggestions.\n\n' +
      'SYNCHRONOUS AND SLOW: reading the window and drafting takes up to about two ' +
      'minutes. Clients should show a bounded progress narrative rather than a spinner.\n\n' +
      'AN EMPTY `suggestions` ARRAY IS A SUCCESSFUL RESULT — it means the data ' +
      'supported nothing worth proposing. The list is never padded to reach ten. A ' +
      'run the model could not complete answers 502 instead, and stores nothing.\n\n' +
      '`sections.failed` names any analytics section that could not be read, so a ' +
      'reader judging a suggestion knows what the model could not see.',
  })
  @ApiResponse({
    status: 200,
    description: 'The run completed (possibly with zero suggestions)',
    type: GenerateSuggestionsResponseDto,
  })
  @ApiResponse({
    status: 502,
    description: 'The model returned unreadable output; nothing was saved',
  })
  async generate(
    @Body() body: GenerateSuggestionsDto,
    @Req() req: { user: { id: number } },
  ): Promise<GenerateSuggestionsResponseDto> {
    return this.suggestionsService.generate(req.user.id, body);
  }

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_SUGGESTIONS)
  @ApiOperation({
    summary: 'List suggestions',
    description:
      'Newest first, with rows from one Generate run kept adjacent so the client ' +
      'can group by `batchId`. Defaults to `status=pending` — the decisions still ' +
      'outstanding. Batches accumulate: generating again adds a batch rather than ' +
      'replacing the queue, and each row carries the window it was derived from.',
  })
  @ApiResponse({ status: 200, type: ListSuggestionsResponseDto })
  async list(
    @Query() query: ListSuggestionsQueryDto,
  ): Promise<ListSuggestionsResponseDto> {
    return this.suggestionsService.list(
      query.status ?? AnalyticsSuggestionStatus.PENDING,
    );
  }

  @Post(':id/accept')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_SUGGESTIONS)
  @ApiOperation({
    summary: 'Accept a suggestion and file it on the roadmap',
    description:
      'Files the suggestion as a roadmap opportunity (stage `new`, no coins) and ' +
      'marks it accepted, linking the two.\n\n' +
      'The body carries what the REVIEWER agreed to, not what the model drafted: ' +
      'accept opens an editable form, and the description, goal and type sent here ' +
      'are what gets filed.\n\n' +
      'Answers 409 if the suggestion was already decided (including by another ' +
      'reviewer in another tab) and 422 if the product goal is no longer live.',
  })
  @ApiResponse({ status: 201, type: AcceptSuggestionResponseDto })
  @ApiResponse({ status: 409, description: 'Already accepted or rejected' })
  @ApiResponse({ status: 422, description: 'Product goal is not live' })
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptSuggestionDto,
    @Req() req: { user: { id: number } },
  ): Promise<AcceptSuggestionResponseDto> {
    return this.suggestionsService.accept(req.user.id, id, body);
  }

  @Post(':id/reject')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS_SUGGESTIONS)
  @ApiOperation({
    summary: 'Reject a suggestion',
    description:
      'Removes the suggestion from the pending queue and records the decision. ' +
      'The optional `reason` is fed into later generations as a standing decision, ' +
      'which is what stops the same idea being proposed every run — a rejection ' +
      'without one suppresses this exact suggestion only.',
  })
  @ApiResponse({ status: 201, type: SuggestionDto })
  @ApiResponse({ status: 409, description: 'Already accepted or rejected' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectSuggestionDto,
    @Req() req: { user: { id: number } },
  ): Promise<SuggestionDto> {
    return this.suggestionsService.reject(req.user.id, id, body);
  }
}
