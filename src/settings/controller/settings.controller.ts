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
import { Public } from 'src/auth/decorators/auth.metadata';
import { LegalContentKey } from '../type/settings.type';
import {
  LegalContentResponseDto,
  UpdateLegalContentDto,
} from '../dto/legal-content.dto';
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
    summary: 'Update hidden summary sections (super admin only)',
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
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only super admin can update',
  })
  @AuthPermissions([PERMISSIONS.SYSTEM_ACCESS])
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

  // --- Legal / consent content (Terms, Privacy, sign-in Terms & Agreement) ---
  // GETs are public so unauthenticated legal pages and the post-login consent
  // popup (whose token isn't persisted yet) can read the content. Edits are
  // restricted to admins via EDIT_GLOBAL_SETTINGS.

  @Public()
  @Get('terms')
  @ApiOperation({ summary: 'Get Terms of Service content' })
  @ApiResponse({ status: 200, type: LegalContentResponseDto })
  getTerms() {
    return this.service.getLegalContent(LegalContentKey.TERMS);
  }

  @Put('terms')
  @ApiOperation({ summary: 'Update Terms of Service content' })
  @ApiBody({ type: UpdateLegalContentDto })
  @ApiResponse({ status: 200, description: 'Terms of Service updated' })
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  updateTerms(@Body() body: UpdateLegalContentDto) {
    return this.service.updateLegalContent(LegalContentKey.TERMS, body);
  }

  @Public()
  @Get('privacy')
  @ApiOperation({ summary: 'Get Privacy Policy content' })
  @ApiResponse({ status: 200, type: LegalContentResponseDto })
  getPrivacy() {
    return this.service.getLegalContent(LegalContentKey.PRIVACY);
  }

  @Put('privacy')
  @ApiOperation({ summary: 'Update Privacy Policy content' })
  @ApiBody({ type: UpdateLegalContentDto })
  @ApiResponse({ status: 200, description: 'Privacy Policy updated' })
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  updatePrivacy(@Body() body: UpdateLegalContentDto) {
    return this.service.updateLegalContent(LegalContentKey.PRIVACY, body);
  }

  @Public()
  @Get('terms-and-agreement')
  @ApiOperation({ summary: 'Get sign-in Terms & Agreement consent content' })
  @ApiResponse({ status: 200, type: LegalContentResponseDto })
  getTermsAndAgreement() {
    return this.service.getLegalContent(LegalContentKey.TERMS_AND_AGREEMENT);
  }

  @Put('terms-and-agreement')
  @ApiOperation({ summary: 'Update sign-in Terms & Agreement consent content' })
  @ApiBody({ type: UpdateLegalContentDto })
  @ApiResponse({ status: 200, description: 'Terms & Agreement updated' })
  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  updateTermsAndAgreement(@Body() body: UpdateLegalContentDto) {
    return this.service.updateLegalContent(
      LegalContentKey.TERMS_AND_AGREEMENT,
      body,
    );
  }
}
