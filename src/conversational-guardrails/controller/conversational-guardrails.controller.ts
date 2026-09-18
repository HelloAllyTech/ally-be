import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ConversationalGuardrailsService } from '../service/conversational-guardrails.service';
import { CreateConversationalGuardrailDto } from '../dto/create-conversational-guardrails.dto';
import { UpdateConversationalGuardrailDto } from '../dto/update-conversational-guardrails.dto';

@ApiTags('Conversational Guardrails')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/learn/conversational-guardrails')
export class ConversationalGuardrailsController {
  constructor(
    private readonly guardrailsService: ConversationalGuardrailsService,
  ) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.MANAGE_GUARDRAILS, {
    permissions: [PERMISSIONS.VIEW_GUARDRAILS],
  })
  @ApiOperation({
    summary: 'Get all guardrails with optional search and pagination',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'order', required: false })
  async getGuardrails(
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'ASC' | 'DESC',
  ) {
    const data = await this.guardrailsService.getGuardrails(search, {
      limit,
      offset,
      sortBy,
      order,
    });

    return data;
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.MANAGE_GUARDRAILS, {
    permissions: [PERMISSIONS.EDIT_GUARDRAILS],
  })
  @ApiOperation({ summary: 'Create a new guardrail' })
  async createGuardrail(@Body() createDto: CreateConversationalGuardrailDto) {
    return this.guardrailsService.createGuardrail(createDto);
  }

  @Put(':id')
  @RequireFeatureToggle(FeatureToggleKey.MANAGE_GUARDRAILS, {
    permissions: [PERMISSIONS.EDIT_GUARDRAILS],
  })
  @ApiOperation({ summary: 'Update a guardrail' })
  async updateGuardrail(
    @Param('id') id: string,
    @Body() updateDto: UpdateConversationalGuardrailDto,
  ) {
    return this.guardrailsService.updateGuardrail(id, updateDto);
  }
}
