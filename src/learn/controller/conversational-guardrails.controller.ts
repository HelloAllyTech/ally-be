import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ConversationalGuardrailsService } from '../service/conversational-guardrails.service';
import {
  CreateConversationalGuardrailDto,
  UpdateConversationalGuardrailDto,
} from '../dto/conversational-guardrails.dto';

@ApiTags('Conversational Guardrails')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/learn/conversational-guardrails')
export class ConversationalGuardrailsController {
  constructor(
    private readonly guardrailsService: ConversationalGuardrailsService,
  ) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_GUARDRAILS])
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
    const total = await this.guardrailsService.countGuardrails(search);
    return { data, total };
  }

  @Get('random')
  @AuthPermissions([PERMISSIONS.VIEW_GUARDRAILS])
  @ApiOperation({ summary: 'Get random guardrails for a session (max 25)' })
  @ApiQuery({ name: 'languageId', required: false })
  async getRandomGuardrails(@Query('languageId') languageId?: number) {
    return this.guardrailsService.getRandomGuardrailsForSession(languageId);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_GUARDRAILS])
  @ApiOperation({ summary: 'Get guardrail by ID' })
  async getGuardrailById(@Param('id') id: string) {
    return this.guardrailsService.getGuardrailById(id);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_GUARDRAILS])
  @ApiOperation({ summary: 'Create a new guardrail' })
  async createGuardrail(@Body() createDto: CreateConversationalGuardrailDto) {
    return this.guardrailsService.createGuardrail(createDto);
  }

  @Post('bulk')
  @AuthPermissions([PERMISSIONS.EDIT_GUARDRAILS])
  @ApiOperation({ summary: 'Create multiple guardrails' })
  async createGuardrails(
    @Body() createDtos: CreateConversationalGuardrailDto[],
  ) {
    return this.guardrailsService.createGuardrails(createDtos);
  }

  @Put(':id')
  @AuthPermissions([PERMISSIONS.EDIT_GUARDRAILS])
  @ApiOperation({ summary: 'Update a guardrail' })
  async updateGuardrail(
    @Param('id') id: string,
    @Body() updateDto: UpdateConversationalGuardrailDto,
  ) {
    return this.guardrailsService.updateGuardrail(id, updateDto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.EDIT_GUARDRAILS])
  @ApiOperation({ summary: 'Delete a guardrail' })
  async deleteGuardrail(@Param('id') id: string) {
    return this.guardrailsService.deleteGuardrail(id);
  }

  @Delete()
  @AuthPermissions([PERMISSIONS.EDIT_GUARDRAILS])
  @ApiOperation({ summary: 'Delete multiple guardrails' })
  async deleteGuardrails(@Body() body: { ids: string[] }) {
    return this.guardrailsService.deleteGuardrails(body.ids);
  }
}
