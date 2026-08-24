import { Controller, Get, Body, Put, Query } from '@nestjs/common';
import { SettingsService } from '../service/settings.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { SUPER_DUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';
import { Public } from 'src/auth/decorators/auth.metadata';
import { UpdateLegalContentDto } from '../dto/legal-content.dto';
import { LEGAL_CONTENT_NAMES } from '../constants/settings.constants';
import { UpdateTurnEndpointingSettingsDto } from '../dto/turn-endpointing-settings.dto';
import {
  GetSummaryFieldsDto,
  UpdateSummaryFieldsDto,
} from '../dto/summary-fields.dto';
import {
  GetSummarySectionsResponseDto,
  UpdateSummarySectionsDto,
} from '../dto/summary-sections.dto';
import { GetChatTypesDto, UpdateChatTypesDto } from '../dto/chat-types.dto';

@ApiTags('Settings')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get('summary-fields')
  @ApiOperation({ summary: 'Get summary fields' })
  @ApiResponse({
    status: 200,
    description: 'Returns the summary fields configuration',
    type: [String],
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    type: String,
    description: 'Tenant ID',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS])
  getSummaryFields(@Query() query?: GetSummaryFieldsDto) {
    return this.service.getSummaryFieldsConfig(query || {});
  }

  @Put('summary-fields')
  @ApiOperation({ summary: 'Update hidden summary fields' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenFields: { type: 'array', items: { type: 'string' } },
        tenantId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Summary fields updated successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS])
  updateSummaryFields(@Body() body: UpdateSummaryFieldsDto) {
    return this.service.updateSummaryFields(body);
  }

  @Get('summary-sections')
  @ApiOperation({ summary: 'Get summary sections config' })
  @ApiResponse({
    status: 200,
    description:
      'Returns sections with defaultVisibility, enabled state and per-section fields with visible state',
    type: GetSummarySectionsResponseDto,
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    type: String,
    description: 'Tenant ID',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS])
  getSummarySections(@Query() query?: GetSummaryFieldsDto) {
    return this.service.getSummarySectionsConfig(query || {});
  }

  @Put('summary-sections')
  @ApiOperation({
    summary:
      'Update hidden summary sections. Super admins may pass any tenantId; ' +
      'a tenant admin is scoped server-side to their own tenant.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenSections: { type: 'array', items: { type: 'string' } },
        tenantId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Summary sections updated successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS])
  updateSummarySections(@Body() body: UpdateSummarySectionsDto) {
    return this.service.updateSummarySections(body);
  }

  @Get('nudge-status')
  @ApiOperation({ summary: 'Get nudge status' })
  @ApiResponse({
    status: 200,
    description: 'Returns the nudge status',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS])
  getNudgeStatus() {
    return this.service.getNudgeStatus();
  }

  @Put('nudge-status')
  @ApiOperation({ summary: 'Update nudge status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Nudge status updated successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS])
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }

  @Get('chat-types')
  @ApiOperation({ summary: 'Get enabled chat types' })
  @ApiResponse({
    status: 200,
    description: 'Returns the enabled chat types',
  })
  @ApiQuery({
    name: 'tenantId',
    required: false,
    type: String,
    description: 'Tenant ID',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES])
  getChatTypes(@Query() query?: GetChatTypesDto) {
    return this.service.getChatTypes(query || {});
  }

  @Get('custom-field-types')
  @ApiOperation({ summary: 'Get enabled custom field types for the org' })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CUSTOM_FIELD_TYPES])
  getEnabledCustomFieldTypes(@Query('tenantId') tenantId?: string) {
    return this.service.getEnabledCustomFieldTypes(tenantId);
  }

  @Get('custom-fields-enabled')
  @ApiOperation({
    summary: 'Get whether the custom fields feature is enabled for the org',
  })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CUSTOM_FIELD_TYPES])
  getCustomFieldsEnabled(@Query('tenantId') tenantId?: string) {
    return this.service.getCustomFieldsEnabled(tenantId);
  }

  @Get('character-library-enabled')
  @ApiOperation({
    summary:
      'Whether the Character Library is enabled for the org (own org unless the caller has SYSTEM_ACCESS)',
  })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiResponse({ status: 200 })
  // Authenticated-only on purpose: the answer is a single boolean about the
  // caller's OWN org (the service pins a non-SYSTEM_ACCESS caller to their JWT
  // tenant), and the admin sidebar has to ask it before it knows whether the
  // user has any character permissions at all.
  @AuthPermissions([])
  getCharacterLibraryEnabled(@Query('tenantId') tenantId?: string) {
    return this.service.getCharacterLibraryEnabled(tenantId);
  }

  @Put('character-library-enabled')
  @ApiOperation({
    summary:
      'Enable or disable the Character Library for an org (platform admin only)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  updateCharacterLibraryEnabled(
    @Body() body: { tenantId: string; enabled: boolean },
  ) {
    return this.service.updateCharacterLibraryEnabled(
      body.tenantId,
      body.enabled,
    );
  }

  @Put('custom-fields-enabled')
  @ApiOperation({
    summary: 'Enable or disable the custom fields feature (superadmin only)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CUSTOM_FIELD_TYPES])
  updateCustomFieldsEnabled(
    @Body() body: { tenantId: string; enabled: boolean },
  ) {
    return this.service.updateCustomFieldsEnabled(body.tenantId, body.enabled);
  }

  @Get('scribe-note-creation-enabled')
  @ApiOperation({
    summary: 'Get whether manual scribe note creation is enabled for the org',
  })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CUSTOM_FIELD_TYPES])
  getScribeNoteCreationEnabled(@Query('tenantId') tenantId?: string) {
    return this.service.getScribeNoteCreationEnabled(tenantId);
  }

  @Put('scribe-note-creation-enabled')
  @ApiOperation({
    summary: 'Enable or disable manual scribe note creation (superadmin only)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CUSTOM_FIELD_TYPES])
  updateScribeNoteCreationEnabled(
    @Body() body: { tenantId: string; enabled: boolean },
  ) {
    return this.service.updateScribeNoteCreationEnabled(
      body.tenantId,
      body.enabled,
    );
  }

  @Get('scribe-voice-note-enabled')
  @ApiOperation({
    summary:
      'Get whether scribe voice-note (mic dictation) is enabled for the org',
  })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CUSTOM_FIELD_TYPES])
  getScribeVoiceNoteEnabled(@Query('tenantId') tenantId?: string) {
    return this.service.getScribeVoiceNoteEnabled(tenantId);
  }

  @Put('scribe-voice-note-enabled')
  @ApiOperation({
    summary: 'Enable or disable scribe voice-note (mic dictation) for the org',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CUSTOM_FIELD_TYPES])
  updateScribeVoiceNoteEnabled(
    @Body() body: { tenantId: string; enabled: boolean },
  ) {
    return this.service.updateScribeVoiceNoteEnabled(
      body.tenantId,
      body.enabled,
    );
  }

  @Put('custom-field-types')
  @ApiOperation({
    summary: 'Update enabled custom field types (superadmin only)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        enabledTypes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CUSTOM_FIELD_TYPES])
  updateEnabledCustomFieldTypes(
    @Body() body: { tenantId: string; enabledTypes: string[] },
  ) {
    return this.service.updateEnabledCustomFieldTypes(
      body.tenantId,
      body.enabledTypes,
    );
  }

  @Put('chat-types')
  @ApiOperation({ summary: 'Update hidden chat types' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenChatTypes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Hidden chat types updated successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CHAT_TYPES])
  updateHiddenChatTypes(@Body() body: UpdateChatTypesDto) {
    return this.service.updateChatTypes(body);
  }

  @Get('terms')
  @Public()
  @ApiOperation({ summary: 'Get Terms of Service content (public)' })
  @ApiResponse({
    status: 200,
    description: 'Returns the Terms of Service HTML content',
  })
  getTerms() {
    return this.service.getLegalContent(LEGAL_CONTENT_NAMES.TERMS);
  }

  @Get('privacy')
  @Public()
  @ApiOperation({ summary: 'Get Privacy Policy content (public)' })
  @ApiResponse({
    status: 200,
    description: 'Returns the Privacy Policy HTML content',
  })
  getPrivacy() {
    return this.service.getLegalContent(LEGAL_CONTENT_NAMES.PRIVACY);
  }

  @Put('terms')
  @ApiOperation({
    summary: 'Update Terms of Service content (super admin only)',
  })
  @ApiBody({ type: UpdateLegalContentDto })
  @ApiResponse({ status: 200, description: 'Terms of Service updated' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only super admin can update',
  })
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  updateTerms(@Body() body: UpdateLegalContentDto) {
    return this.service.updateLegalContent(
      LEGAL_CONTENT_NAMES.TERMS,
      body.html,
    );
  }

  @Put('privacy')
  @ApiOperation({ summary: 'Update Privacy Policy content (super admin only)' })
  @ApiBody({ type: UpdateLegalContentDto })
  @ApiResponse({ status: 200, description: 'Privacy Policy updated' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only super admin can update',
  })
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  updatePrivacy(@Body() body: UpdateLegalContentDto) {
    return this.service.updateLegalContent(
      LEGAL_CONTENT_NAMES.PRIVACY,
      body.html,
    );
  }

  @Get('turn-endpointing')
  @ApiOperation({
    summary:
      'Get the global turn-endpointing bounds (seconds) for Studio v1 roleplay sessions',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns the current turn-endpointing bounds, falling back to LiveKit defaults if none have been saved yet',
  })
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  getTurnEndpointing() {
    return this.service.getTurnEndpointingSettings();
  }

  @Put('turn-endpointing')
  @ApiOperation({
    summary:
      'Update the global turn-endpointing bounds (seconds) for Studio v1 roleplay sessions (super admin only)',
  })
  @ApiBody({ type: UpdateTurnEndpointingSettingsDto })
  @ApiResponse({ status: 200, description: 'Turn-endpointing bounds updated' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only super admin can update',
  })
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  updateTurnEndpointing(@Body() body: UpdateTurnEndpointingSettingsDto) {
    return this.service.updateTurnEndpointingSettings(body);
  }
}
