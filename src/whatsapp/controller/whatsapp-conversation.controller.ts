import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  WaHandledBy,
  WaUnansweredReason,
  WaUnansweredStatus,
} from '../enum/whatsapp.enum';
import { WhatsAppConversationService } from '../service/whatsapp-conversation.service';

/**
 * Conversation log, unanswered queue and usage dashboard.
 *
 * The `:conversations` permissions are the most sensitive this feature defines — these rows hold
 * mental healthcare workers' clinical questions next to their phone numbers — so they are granted to
 * SUPER_DUPER_ADMIN alone (migration 1892000000009).
 *
 * Phone numbers come back masked to the last four digits everywhere except the explicit reveal
 * endpoint, which logs each use.
 */
@ApiTags('WhatsApp Bot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/whatsapp')
export class WhatsAppConversationController {
  constructor(
    private readonly conversationService: WhatsAppConversationService,
  ) {}

  // ── conversations ─────────────────────────────────────────────────────

  @Get('conversations')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'List conversation threads (phone numbers masked)',
    description:
      'Newest activity first. Message-level filters are applied as EXISTS subqueries so a thread ' +
      'appears once regardless of how many of its messages match.',
  })
  listConversations(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('handledBy') handledBy?: WaHandledBy,
    @Query('language') language?: string,
    @Query('declinedOnly') declinedOnly?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.conversationService.listConversations({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      handledBy,
      language,
      declinedOnly: declinedOnly === 'true',
      search,
      sortBy,
      sortDir,
    });
  }

  @Get('conversations/languages')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'Distinct languages present in the conversation log',
    description:
      'Populates the log filter. Declared ABOVE conversations/:id so the literal path is matched ' +
      'first — otherwise "languages" is read as a conversation id and the request 400s on the UUID ' +
      'pipe.',
  })
  listLanguages() {
    return this.conversationService.listLanguages();
  }

  @Get('conversations/:id')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'One thread with its messages, citations and retrieval metadata',
    description:
      'Each answer carries the provider and model that ACTUALLY ran, so a behaviour change after an ' +
      'admin swaps models is explainable after the fact.',
  })
  getConversation(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.getConversation(id);
  }

  @Get('citations/:chunkId')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'Resolve a citation to the exact passage that was quoted',
    description:
      'Reads the chunk row, not the vector index: a document re-chunked since the answer was sent ' +
      'has new vector objects, but the row holding the quoted text is still there.',
  })
  resolveCitation(@Param('chunkId', ParseUUIDPipe) chunkId: string) {
    return this.conversationService.resolveCitation(chunkId);
  }

  @Post('contacts/:id/reveal')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'Return one contact full phone number',
    description:
      'The only endpoint that emits an unmasked number, and every call is logged. Needed to follow ' +
      'up on a crisis message or block a specific number; nothing else hands it out.',
  })
  revealPhone(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.revealContactPhone(id);
  }

  @Post('contacts/:id/block')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'Block a number',
    description:
      'Blocked numbers are dropped silently — telling an abuser exactly when they were blocked ' +
      'mostly teaches them to switch numbers.',
  })
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.conversationService.setContactBlocked(id, true, body?.reason);
  }

  @Post('contacts/:id/unblock')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({ summary: 'Unblock a number' })
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.setContactBlocked(id, false);
  }

  @Post('contacts/:id/erase')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_CONVERSATIONS])
  @ApiOperation({
    summary: 'Erase a contact message content and number, keeping counts',
    description:
      'There is no account to delete. Bodies and the number are blanked while the aggregate counts ' +
      'survive, so an erasure does not silently rewrite historical usage figures.',
  })
  erase(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.eraseContact(id);
  }

  // ── unanswered queue ──────────────────────────────────────────────────

  @Get('unanswered')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_UNANSWERED])
  @ApiOperation({
    summary: 'Questions the corpus could not answer',
    description:
      'Defaults to open items. Clarification requests are deliberately absent — a vague question is ' +
      'not evidence of a corpus gap, and including them would bury the real gaps.',
  })
  listUnanswered(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: WaUnansweredStatus,
    @Query('reason') reason?: WaUnansweredReason,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.conversationService.listUnanswered({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      status,
      reason,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      sortBy,
      sortDir,
    });
  }

  @Patch('unanswered/:id')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_UNANSWERED])
  @ApiOperation({ summary: 'Triage, assign, annotate or resolve a gap' })
  @ApiResponse({ status: 404, description: 'No such question' })
  updateUnanswered(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      status?: WaUnansweredStatus;
      assignedTo?: number | null;
      resolutionNote?: string;
      linkedDocumentId?: string;
    },
  ) {
    return this.conversationService.updateUnanswered(id, body);
  }

  @Post('unanswered/:id/create-document')
  @AuthPermissions([PERMISSIONS.EDIT_WHATSAPP_BOT_UNANSWERED])
  @ApiOperation({
    summary:
      'Close the loop: write the answer as a corpus document and resolve the gap',
    description:
      'The admin supplies the answer text. The question is deliberately NOT used as the body — a ' +
      'document containing the question and no answer embeds well against it and helps nobody.',
  })
  createDocumentFromUnanswered(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { title: string; text: string; tags?: string[] },
  ) {
    return this.conversationService.createDocumentFromUnanswered(id, body);
  }

  // ── analytics ─────────────────────────────────────────────────────────

  @Get('analytics/overview')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_ANALYTICS])
  @ApiOperation({
    summary: 'Headline counts, outcome mix and reply latency',
    description:
      'Latency is p50/p95 rather than a mean: one slow outlier drags an average enough to hide that ' +
      'the typical reply is fast, and p95 is what a waiting worker actually experiences.',
  })
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.conversationService.overview(from, to);
  }

  @Get('analytics/timeseries')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_ANALYTICS])
  @ApiOperation({ summary: 'Daily outcome counts for the trend chart' })
  timeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.conversationService.timeseries(from, to);
  }

  @Get('analytics/languages')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_ANALYTICS])
  @ApiOperation({
    summary: 'Language mix with decline rate per language',
    description:
      'The most important number here. It turns the cross-lingual retrieval risk into a measurement: ' +
      'if Hindi or Tamil declines far more than English, retrieval is failing before the answer is ' +
      'written. Rates are null below a minimum sample rather than computed from a handful.',
  })
  languages(@Query('from') from?: string, @Query('to') to?: string) {
    return this.conversationService.languages(from, to);
  }

  @Get('analytics/corpus-coverage')
  @AuthPermissions([PERMISSIONS.VIEW_WHATSAPP_BOT_ANALYTICS])
  @ApiOperation({
    summary: 'Citations per document, including documents never cited',
    description:
      'The never-cited half is the useful half: such a document is either badly chunked, badly ' +
      'titled for retrieval, or about something nobody asks.',
  })
  corpusCoverage(@Query('from') from?: string, @Query('to') to?: string) {
    return this.conversationService.corpusCoverage(from, to);
  }
}
