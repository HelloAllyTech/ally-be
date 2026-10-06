import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import {
  AcknowledgeRiskFlagDto,
  AlertSupervisorDto,
  AssignChatDto,
  BlockTalkerDto,
  CopilotFeedbackDto,
  HelplineAfterIdQueryDto,
  ListChatsQueryDto,
  QaListQueryDto,
  RiskFlagsQueryDto,
  TeamQueryDto,
  UpdateListenerProfileDto,
  UpdatePresenceDto,
  UpdateSummaryDto,
  TransferChatDto,
  UpdateTeamMemberDto,
  WhisperDto,
} from '../dto/helpline.dto';
import {
  HelplineTenantParam,
  RequireHelplineEnabled,
  RequireHelplineEnabledForChat,
} from '../guard/helpline-enabled.guard';
import { HelplineClaimService } from '../service/helpline-claim.service';
import { HelplineListenerService } from '../service/helpline-listener.service';
import { HelplineMonitorService } from '../service/helpline-monitor.service';
import { HelplineQaService } from '../service/helpline-qa.service';
import { HelplineSupervisionService } from '../service/helpline-supervision.service';
import { HelplineTeamService } from '../service/helpline-team.service';
import {
  ChatDetailDto,
  HelplineStaffUser,
  HelplineTenant,
  LobbyDto,
  MeDto,
} from '../type/helpline.types';
import { HelplineChatIdPipe, HelplineUserIdPipe } from '../util/helpline-pipes';
import {
  MonitorDto,
  QaDetailDto,
  QaListItemDto,
  RiskCalibrationDto,
  StaffMessageDto,
} from '../type/helpline.types';

/**
 * Listener / supervisor routes (contract §5.3).
 *
 * Every route but `enabled` carries BOTH `@AuthPermissions` and
 * `@RequireHelplineEnabled()`, with the gate written ABOVE the permission
 * decorator so its guard runs after AuthGuard('jwt') has set `request.user`
 * (pinned by helpline-controller-guards.spec.ts). There are no global guards
 * in this app — a route without them is public.
 *
 * The supervision routes (transfer, assign, take-over, whisper, block,
 * monitor, risk-flag calibration, QA, copilot feedback) arrive with the second
 * backend pass; the schema for them already exists.
 */
@ApiTags('Text helpline — listener')
@ApiBearerAuth()
@Controller({ path: 'helpline', version: '1' })
export class HelplineController {
  constructor(
    private readonly listeners: HelplineListenerService,
    private readonly claims: HelplineClaimService,
    private readonly team: HelplineTeamService,
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly supervision: HelplineSupervisionService,
    private readonly monitorService: HelplineMonitorService,
    private readonly qa: HelplineQaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * The nav gate: authenticated only, never a 403 (contract §5.3). While the
   * helpline is switched off, `continuingChatIds` lists the ACTIVE chats the
   * caller is still listener of record for, so the workspace can keep those
   * open (the chat-scoped routes still serve them); always [] when enabled.
   */
  @AuthPermissions([])
  @Get('enabled')
  @ApiOperation({
    summary: 'Whether the text helpline is on for my organisation',
  })
  async enabled(
    @CurrentUser() user: HelplineStaffUser,
  ): Promise<{ enabled: boolean; continuingChatIds: string[] }> {
    const enabled = await this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      user.tenantId,
    );
    return {
      enabled,
      continuingChatIds: enabled
        ? []
        : await this.listeners.continuingChatIds(user),
    };
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_LOBBY])
  @Get('me')
  me(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
  ): Promise<MeDto> {
    return this.listeners.me(tenant, user.id);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_PRESENCE])
  @Put('me/profile')
  updateProfile(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Body() body: UpdateListenerProfileDto,
  ): Promise<MeDto> {
    return this.listeners.updateProfile(tenant, user.id, body);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_PRESENCE])
  @Put('me/presence')
  async updatePresence(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Body() body: UpdatePresenceDto,
  ): Promise<MeDto> {
    await this.listeners.setPresence(tenant, user.id, body.status);
    return this.listeners.me(tenant, user.id);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_LOBBY])
  @Get('lobby')
  lobby(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
  ): Promise<LobbyDto> {
    return this.listeners.lobby(tenant, user.id);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_CHAT])
  @Get('chats')
  @ApiOperation({
    summary: 'History: my chats, or all (needs view:helpline:monitor)',
  })
  listChats(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Query() query: ListChatsQueryDto,
  ) {
    return this.listeners.listChats(tenant, user, query);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_CLAIM])
  @Post('chats/:id/claim')
  @HttpCode(HttpStatus.OK)
  claim(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
  ): Promise<ChatDetailDto> {
    return this.claims.claim(tenant, chatId, user.id);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_CHAT])
  @Get('chats/:id')
  chatDetail(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
  ): Promise<ChatDetailDto> {
    return this.listeners.chatDetail(tenant, chatId, user);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_CHAT])
  @Get('chats/:id/messages')
  chatMessages(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Query() query: HelplineAfterIdQueryDto,
  ) {
    return this.listeners.chatMessages(tenant, chatId, user, query.afterId);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_END])
  @Post('chats/:id/end')
  @HttpCode(HttpStatus.OK)
  endChat(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
  ): Promise<ChatDetailDto> {
    return this.listeners.endChat(tenant, chatId, user);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_SUMMARY])
  @Put('chats/:id/summary')
  saveSummary(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: UpdateSummaryDto,
  ) {
    return this.listeners.saveSummary(tenant, chatId, user, body.fields);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_COPILOT])
  @Post('chats/:id/risk-flags/:flagId/ack')
  @HttpCode(HttpStatus.OK)
  acknowledgeFlag(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Param('flagId', HelplineChatIdPipe) flagId: string,
    @Body() body: AcknowledgeRiskFlagDto,
  ) {
    return this.listeners.acknowledgeFlag(
      tenant,
      chatId,
      flagId,
      user,
      body.outcome,
      body.note,
    );
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_COPILOT])
  @Post('chats/:id/copilot-feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rate a copilot suggestion or nudge' })
  async copilotFeedback(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: CopilotFeedbackDto,
  ): Promise<void> {
    await this.listeners.copilotFeedback(tenant, chatId, user, body);
  }

  @RequireHelplineEnabledForChat()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_COPILOT])
  @Post('chats/:id/alert-supervisor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Listener of record asks a supervisor for help (returns how many were alerted)',
  })
  alertSupervisor(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: AlertSupervisorDto,
  ): Promise<{ alertedCount: number }> {
    return this.listeners.alertSupervisor(tenant, chatId, user, body.note);
  }

  // ── Supervision (contract §5.3, §10) ─────────────────────────────────────

  /**
   * `edit:helpline:end` is the floor (listeners and supervisors both hold
   * it); the service then requires the listener of record OR
   * `edit:helpline:transfer` — the contract's "either" rule, which a single
   * AND/OR permission list cannot express.
   */
  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_END])
  @Post('chats/:id/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put an active chat up for another listener' })
  transfer(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: TransferChatDto,
  ): Promise<ChatDetailDto> {
    return this.supervision.transfer(
      tenant,
      chatId,
      user,
      body.targetListenerId ?? null,
    );
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_TRANSFER])
  @Post('chats/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aim a waiting or transfer-pending chat at one listener',
  })
  assign(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: AssignChatDto,
  ): Promise<ChatDetailDto> {
    return this.supervision.assign(tenant, chatId, user, body.listenerId);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_TRANSFER])
  @Post('chats/:id/take-over')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Become the listener of record now' })
  takeOver(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
  ): Promise<ChatDetailDto> {
    return this.supervision.takeOver(tenant, chatId, user);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_WHISPER])
  @Post('chats/:id/whisper')
  @ApiOperation({ summary: 'A staff-only note into an open chat' })
  whisper(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
    @Body() body: WhisperDto,
  ): Promise<StaffMessageDto> {
    return this.supervision.whisper(tenant, chatId, user, body.content);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_TRANSFER])
  @Post('talkers/:talkerId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Block a talker: ends their chat, refuses their ip for 24 h',
  })
  async blockTalker(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('talkerId', HelplineChatIdPipe) talkerId: string,
    @Body() body: BlockTalkerDto,
  ): Promise<void> {
    await this.supervision.block(tenant, talkerId, user, body?.reason);
  }

  // ── Monitor + calibration ────────────────────────────────────────────────

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_MONITOR])
  @Get('monitor')
  @ApiOperation({ summary: 'Live supervisor monitor for my organisation' })
  monitor(@HelplineTenantParam() tenant: HelplineTenant): Promise<MonitorDto> {
    return this.monitorService.monitor(tenant);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_MONITOR])
  @Get('risk-flags')
  @ApiOperation({
    summary:
      'Risk flags and outcomes over a window, to calibrate the classifier',
  })
  riskFlags(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Query() query: RiskFlagsQueryDto,
  ): Promise<RiskCalibrationDto> {
    return this.monitorService.calibration(tenant, user, query);
  }

  // ── QA (contract §10) — scores 1–4, never ranked ─────────────────────────

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_QA])
  @Get('qa')
  @ApiOperation({ summary: "Listeners' QA scores, newest first (supervisors)" })
  qaList(
    @HelplineTenantParam() tenant: HelplineTenant,
    @Query() query: QaListQueryDto,
  ): Promise<{ items: QaListItemDto[]; total: number }> {
    return this.qa.list(tenant, query);
  }

  /** Declared before `qa/:chatId` so "mine" is never read as a chat id. */
  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_LOBBY])
  @Get('qa/mine')
  @ApiOperation({ summary: 'My own QA scores' })
  qaMine(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
  ): Promise<{ items: QaListItemDto[] }> {
    return this.qa.mine(tenant, user);
  }

  /** Own chat with the lobby permission, or any chat with view:helpline:qa. */
  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_LOBBY])
  @Get('qa/:chatId')
  @ApiOperation({ summary: 'One QA breakdown (own, or view:helpline:qa)' })
  async qaDetail(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('chatId', HelplineChatIdPipe) chatId: string,
  ): Promise<QaDetailDto> {
    return this.qa.detail(
      tenant,
      chatId,
      user,
      await this.permissionsService.getUserPermissions(user.id),
    );
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_TEAM])
  @Get('team')
  listTeam(
    @HelplineTenantParam() tenant: HelplineTenant,
    @Query() query: TeamQueryDto,
  ) {
    return this.team.list(tenant, query.search);
  }

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.EDIT_HELPLINE_TEAM])
  @Put('team/:userId')
  updateTeamMember(
    @HelplineTenantParam() tenant: HelplineTenant,
    @Param('userId', HelplineUserIdPipe) userId: number,
    @Body() body: UpdateTeamMemberDto,
  ) {
    return this.team.update(tenant, userId, body);
  }
}
