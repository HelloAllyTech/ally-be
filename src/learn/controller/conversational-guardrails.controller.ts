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
import { ConversationalGuardrailsService } from '../service/conversational-guardrails.service';
import {
  CreateConversationalGuardrailDto,
  UpdateConversationalGuardrailDto,
  CreateConversationalGuardrailTranslationDto,
  UpdateConversationalGuardrailTranslationDto,
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
  @ApiOperation({ summary: 'Get random guardrails for a session (max 25)' })
  @ApiQuery({ name: 'languageId', required: false })
  async getRandomGuardrails(@Query('languageId') languageId?: number) {
    return this.guardrailsService.getRandomGuardrailsForSession(languageId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guardrail by ID' })
  async getGuardrailById(@Param('id') id: string) {
    return this.guardrailsService.getGuardrailById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new guardrail' })
  async createGuardrail(@Body() createDto: CreateConversationalGuardrailDto) {
    return this.guardrailsService.createGuardrail(createDto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create multiple guardrails' })
  async createGuardrails(
    @Body() createDtos: CreateConversationalGuardrailDto[],
  ) {
    return this.guardrailsService.createGuardrails(createDtos);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a guardrail' })
  async updateGuardrail(
    @Param('id') id: string,
    @Body() updateDto: UpdateConversationalGuardrailDto,
  ) {
    return this.guardrailsService.updateGuardrail(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a guardrail' })
  async deleteGuardrail(@Param('id') id: string) {
    return this.guardrailsService.deleteGuardrail(id);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete multiple guardrails' })
  async deleteGuardrails(@Body() body: { ids: string[] }) {
    return this.guardrailsService.deleteGuardrails(body.ids);
  }

  @Get(':id/translations')
  @ApiOperation({ summary: 'Get translations for a guardrail' })
  async getTranslations(@Param('id') guardrailId: string) {
    return this.guardrailsService.getTranslationsByGuardrailId(guardrailId);
  }

  @Post('translations')
  @ApiOperation({ summary: 'Create a translation for a guardrail' })
  async createTranslation(
    @Body() createDto: CreateConversationalGuardrailTranslationDto,
  ) {
    return this.guardrailsService.createTranslation(createDto);
  }

  @Put('translations/:id')
  @ApiOperation({ summary: 'Update a translation' })
  async updateTranslation(
    @Param('id') id: string,
    @Body() updateDto: UpdateConversationalGuardrailTranslationDto,
  ) {
    return this.guardrailsService.updateTranslation(id, updateDto);
  }

  @Delete('translations/:id')
  @ApiOperation({ summary: 'Delete a translation' })
  async deleteTranslation(@Param('id') id: string) {
    return this.guardrailsService.deleteTranslation(id);
  }
}
