import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CustomFieldsService } from '../service/custom-fields.service';
import {
  CreateCustomFieldDefinitionDto,
  ReorderCustomFieldDefinitionsDto,
  UpdateCustomFieldDefinitionDto,
} from '../dto/custom-field-definition.dto';
import {
  CustomFieldValueResponseDto,
  UpsertCustomFieldValuesDto,
} from '../dto/custom-field-value.dto';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';

@ApiTags('Custom Fields')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get('definitions')
  @ApiOperation({
    summary: 'Get all active custom field definitions for the org',
  })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.VIEW_CUSTOM_FIELD_DEFINITIONS])
  getDefinitions() {
    return this.service.getDefinitions();
  }

  @Post('definitions')
  @ApiOperation({ summary: 'Create a custom field definition' })
  @ApiResponse({ status: 201 })
  @AuthPermissions([PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS])
  createDefinition(@Body() dto: CreateCustomFieldDefinitionDto) {
    return this.service.createDefinition(dto);
  }

  @Patch('definitions/reorder')
  @ApiOperation({ summary: 'Reorder all custom field definitions' })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS])
  reorderDefinitions(@Body() dto: ReorderCustomFieldDefinitionsDto) {
    return this.service.reorderDefinitions(dto);
  }

  @Patch('definitions/:id')
  @ApiOperation({ summary: 'Update a custom field definition' })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS])
  updateDefinition(
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDefinitionDto,
  ) {
    return this.service.updateDefinition(id, dto);
  }

  @Delete('definitions/:id')
  @ApiOperation({ summary: 'Soft-delete a custom field definition' })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS])
  deleteDefinition(@Param('id') id: string) {
    return this.service.deleteDefinition(id);
  }

  @Get('values/:chatId')
  @ApiOperation({
    summary: 'Get custom field values merged with definitions for a call',
  })
  @ApiResponse({ status: 200, type: [CustomFieldValueResponseDto] })
  @AuthPermissions([PERMISSIONS.VIEW_CUSTOM_FIELD_DEFINITIONS])
  getValues(@Param('chatId', ParseIntPipe) chatId: number) {
    return this.service.getValues(chatId);
  }

  @Put('values/:chatId')
  @ApiOperation({ summary: 'Upsert custom field values for a call' })
  @ApiResponse({ status: 200 })
  @AuthPermissions([PERMISSIONS.EDIT_CUSTOM_FIELD_VALUES])
  upsertValues(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: UpsertCustomFieldValuesDto,
  ) {
    return this.service.upsertValues(chatId, dto);
  }
}
