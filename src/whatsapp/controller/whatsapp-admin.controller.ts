import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  CreateWaTemplateDto,
  PreviewAskDto,
  ReorderWaTemplatesDto,
  TestWaTemplateDto,
  UpdateWaSettingsDto,
  UpdateWaTemplateDto,
} from '../dto/whatsapp.dto';
import { WaTemplateKind } from '../enum/whatsapp.enum';
import { WhatsAppAdminService } from '../service/whatsapp-admin.service';

/**
 * Admin surface for the WhatsApp Q&A bot. SUPER_DUPER_ADMIN only
 * (migration 1892000000009).
 */
@ApiTags('WhatsApp Bot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/whatsapp')
export class WhatsAppAdminController {
  constructor(private readonly adminService: WhatsAppAdminService) {}

  // ── templates ─────────────────────────────────────────────────────────

  @Get('templates')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'List keyword templates in evaluation order',
    description:
      'Returned in the same (priority, createdAt) order the matcher uses, so the list IS the ' +
      'evaluation order rather than a separate view of it.',
  })
  listTemplates(
    @Query('kind') kind?: WaTemplateKind,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.adminService.listTemplates(kind, includeArchived === 'true');
  }

  @Post('templates')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({ summary: 'Create a keyword template' })
  @ApiResponse({ status: 400, description: 'No patterns, or an invalid regex' })
  createTemplate(@Body() dto: CreateWaTemplateDto) {
    return this.adminService.createTemplate(dto);
  }

  @Patch('templates/:id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Update a template',
    description:
      "A mandatory template's wording is editable, but it cannot be deactivated — 403.",
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot deactivate a required safety template',
  })
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWaTemplateDto,
  ) {
    return this.adminService.updateTemplate(id, dto);
  }

  @Post('templates/:id/archive')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({ summary: 'Archive a template' })
  @ApiResponse({
    status: 403,
    description: 'Cannot remove a required safety template',
  })
  archiveTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.archiveTemplate(id);
  }

  @Post('templates/reorder')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Rewrite priorities from an ordered id list',
    description:
      'Renumbers within each kind band, so a reorder can never move an FAQ rule ahead of a crisis ' +
      'rule.',
  })
  reorderTemplates(@Body() dto: ReorderWaTemplatesDto) {
    return this.adminService.reorderTemplates(dto);
  }

  @Post('templates/test')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Which rule would match this text — sends nothing',
    description:
      'Template ordering is safety-critical and otherwise invisible: an admin cannot tell that a ' +
      'new FAQ rule now swallows a phrase the crisis rule used to catch.',
  })
  testTemplate(@Body() dto: TestWaTemplateDto) {
    return this.adminService.testTemplate(dto);
  }

  // ── settings ──────────────────────────────────────────────────────────

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({ summary: 'The bot settings blob' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Put('settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Update settings',
    description:
      'Merged over what is stored, so a partial save cannot blank a field. Retrieval thresholds ' +
      'take effect on the next message — no deploy.',
  })
  updateSettings(@Body() dto: UpdateWaSettingsDto) {
    return this.adminService.updateSettings(
      dto as unknown as Record<string, unknown>,
    );
  }

  @Get('settings/provider-health')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Whether the provider is configured',
    description:
      'Booleans only, never the values — returning a secret to prove it is set would put it in the ' +
      'browser and in any screenshot of this screen.',
  })
  providerHealth() {
    return this.adminService.providerHealth();
  }

  // ── preview console ───────────────────────────────────────────────────

  @Post('preview/ask')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary:
      'Ask a question and see the exact reply — no send, no rows written',
    description:
      'Returns the composed message including source lines and truncation, plus the passages, ' +
      'scores, model and latency. Writes nothing, so an admin experimenting cannot pollute the ' +
      'conversation log or the unanswered queue.',
  })
  previewAsk(@Body() dto: PreviewAskDto) {
    return this.adminService.previewAsk(dto);
  }
}
