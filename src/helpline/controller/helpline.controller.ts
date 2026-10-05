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
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import {
  AcknowledgeRiskFlagDto,
  HelplineAfterIdQueryDto,
  ListChatsQueryDto,
  TeamQueryDto,
  UpdateListenerProfileDto,
  UpdatePresenceDto,
  UpdateSummaryDto,
  UpdateTeamMemberDto,
} from '../dto/helpline.dto';
import {
  HelplineTenantParam,
  RequireHelplineEnabled,
} from '../guard/helpline-enabled.guard';
import { HelplineClaimService } from '../service/helpline-claim.service';
import { HelplineListenerService } from '../service/helpline-listener.service';
import { HelplineTeamService } from '../service/helpline-team.service';
import {
  ChatDetailDto,
  HelplineStaffUser,
  HelplineTenant,
  LobbyDto,
  MeDto,
} from '../type/helpline.types';
import { HelplineChatIdPipe, HelplineUserIdPipe } from '../util/helpline-pipes';

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
  ) {}

  /** The nav gate: authenticated only, never a 403 (contract §5.3). */
  @AuthPermissions([])
  @Get('enabled')
  @ApiOperation({
    summary: 'Whether the text helpline is on for my organisation',
  })
  async enabled(
    @CurrentUser() user: HelplineStaffUser,
  ): Promise<{ enabled: boolean }> {
    return {
      enabled: await this.tenantFeatureService.isEnabledForTenant(
        PreferenceName.TEXT_HELPLINE_ENABLED,
        user.tenantId,
      ),
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

  @RequireHelplineEnabled()
  @AuthPermissions([PERMISSIONS.VIEW_HELPLINE_CHAT])
  @Get('chats/:id')
  chatDetail(
    @HelplineTenantParam() tenant: HelplineTenant,
    @CurrentUser() user: HelplineStaffUser,
    @Param('id', HelplineChatIdPipe) chatId: string,
  ): Promise<ChatDetailDto> {
    return this.listeners.chatDetail(tenant, chatId, user);
  }

  @RequireHelplineEnabled()
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

  @RequireHelplineEnabled()
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

  @RequireHelplineEnabled()
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

  @RequireHelplineEnabled()
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
