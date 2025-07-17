import { Controller, Get, Body, Put, Post, Delete } from '@nestjs/common';
import { SettingsService } from '../service/settings.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import {
  UserRole,
  HiddenChatType,
} from '../../common/constants/user.constants';

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
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  getSummaryFields() {
    return this.service.getSummaryFieldsConfig();
  }

  @Put('summary-fields')
  @ApiOperation({ summary: 'Update summary fields' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenFields: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Summary fields updated successfully',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  updateSummaryFields(@Body() body: { hiddenFields: string[] }) {
    return this.service.updateSummaryFields(body.hiddenFields);
  }

  @Get('nudge-status')
  @ApiOperation({ summary: 'Get nudge status' })
  @ApiResponse({
    status: 200,
    description: 'Returns the nudge status',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
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
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }

  @Get('hidden-chat-types')
  @ApiOperation({ summary: 'Get hidden chat types' })
  @ApiResponse({
    status: 200,
    description: 'Returns the hidden chat types',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  getHiddenChatTypes() {
    return this.service.getHiddenChatTypes();
  }

  @Post('hidden-chat-types')
  @ApiOperation({ summary: 'Add hidden chat types' })
  @ApiBody({
    schema: {
      type: 'array',
      items: {
        type: 'string',
        enum: Object.values(HiddenChatType),
      },
      example: ['string'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Chat types hidden successfully',
  })
  @AuthRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  addHiddenChatTypes(@Body() chatTypes: string[]) {
    return this.service.addHiddenChatTypes(chatTypes);
  }

  @Delete('hidden-chat-types')
  @ApiOperation({ summary: 'Remove hidden chat types' })
  @ApiBody({
    schema: {
      type: 'array',
      items: {
        type: 'string',
        enum: Object.values(HiddenChatType),
      },
      example: ['string'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Chat types shown successfully',
  })
  @AuthRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  removeHiddenChatTypes(@Body() chatTypes: string[]) {
    return this.service.removeHiddenChatTypes(chatTypes);
  }
}
