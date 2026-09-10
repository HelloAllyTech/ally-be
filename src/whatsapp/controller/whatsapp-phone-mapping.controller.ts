import {
  Body,
  Controller,
  Delete,
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
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  BulkWaPhoneMappingsDto,
  BulkWaPhoneMappingsResponseDto,
  CreateWaPhoneMappingDto,
  GetWaPhoneMappingsQueryDto,
  GetWaPhoneMappingsResponseDto,
  UpdateWaPhoneMappingDto,
  WaPhoneMappingResponseDto,
} from '../dto/whatsapp-phone-mapping.dto';
import { WhatsAppPhoneMappingService } from '../service/whatsapp-phone-mapping.service';

/**
 * Phone → organisation mappings, surfaced in the admin console under User Management.
 *
 * Gated on the WhatsApp bot's own permissions rather than EDIT_USER, even though the UI lives
 * beside the user list: a mapping decides which organisation's clinical material a phone number
 * can be answered from, so it belongs to whoever runs the bot, not to whoever can rename an
 * account. No NEW permission was minted for it — a new permission needs its grants cloned into
 * every future role migration and sits behind a 30-minute Redis cache that raw SQL cannot bust.
 */
@ApiTags('WhatsApp Bot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/whatsapp/phone-mappings')
export class WhatsAppPhoneMappingController {
  constructor(private readonly service: WhatsAppPhoneMappingService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'List phone → organisation mappings',
    description:
      'Numbers are returned in full, unlike everywhere else this feature shows one. These are ' +
      'admin-entered reference data being managed, not observed traffic: masking the number ' +
      'would leave no way to tell which row to remove.',
  })
  @ApiResponse({ status: 200, type: GetWaPhoneMappingsResponseDto })
  list(
    @Query() dto: GetWaPhoneMappingsQueryDto,
  ): Promise<GetWaPhoneMappingsResponseDto> {
    return this.service.list(dto);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Map one number to an organisation',
    description:
      'A number already mapped elsewhere is MOVED rather than rejected — "add this number to ' +
      'Acme" is the same intention whether or not the admin remembers mapping it last year.',
  })
  @ApiResponse({ status: 201, type: WaPhoneMappingResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Too few digits to identify anyone, or an unknown organisation',
  })
  create(
    @Body() dto: CreateWaPhoneMappingDto,
  ): Promise<WaPhoneMappingResponseDto> {
    return this.service.create(dto);
  }

  @Post('bulk')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Upload many mappings, reporting every row',
    description:
      'Per-row outcomes, NOT all-or-nothing: these rows are independent, so one mistyped ' +
      'number must not throw away a 200-line roster. Numbers already mapped to a different ' +
      'organisation come back as conflicts and are left alone unless overwriteConflicts is set.',
  })
  @ApiResponse({ status: 201, type: BulkWaPhoneMappingsResponseDto })
  bulkCreate(
    @Body() dto: BulkWaPhoneMappingsDto,
  ): Promise<BulkWaPhoneMappingsResponseDto> {
    return this.service.bulkCreate(dto);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({ summary: 'Change a mapping’s organisation or label' })
  @ApiResponse({ status: 200, type: WaPhoneMappingResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWaPhoneMappingDto,
  ): Promise<WaPhoneMappingResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Remove a mapping',
    description:
      'Soft, so the removal stays on the record. The number may still resolve through its ' +
      "owner's Ally profile afterwards — this undoes the admin's statement, it does not block " +
      'the number.',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; removed: boolean }> {
    return this.service.remove(id);
  }
}
