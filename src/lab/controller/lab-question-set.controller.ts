import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { LabQuestionSetService } from '../service/lab-question-set.service';
import {
  ArchiveQuestionSetDto,
  CreateQuestionSetDto,
  ListQuestionSetsQueryDto,
  UpdateQuestionSetDto,
} from '../dto/lab-question-set.dto';

@ApiTags('AI Lab - Question Sets')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/question-sets')
export class LabQuestionSetController {
  constructor(private readonly setService: LabQuestionSetService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'List reusable human-eval question sets' })
  list(@Query() query: ListQuestionSetsQueryDto) {
    return this.setService.list(query);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Get one question set with its questions' })
  getById(@Param('id') id: string) {
    return this.setService.getById(id);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary: 'Create a draft question set (optionally with initial questions)',
  })
  create(@Body() dto: CreateQuestionSetDto) {
    return this.setService.create(dto);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary:
      'Edit a draft question set (name/description/full question list) — rejected once published',
  })
  update(@Param('id') id: string, @Body() dto: UpdateQuestionSetDto) {
    return this.setService.update(id, dto);
  }

  @Post(':id/publish')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary: 'Publish (lock) a question set — requires at least one question',
  })
  publish(@Param('id') id: string) {
    return this.setService.publish(id);
  }

  @Patch(':id/archive')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary:
      'Archive/unarchive a published set (hides it from the run-publish picker; reversible)',
  })
  archive(@Param('id') id: string, @Body() dto: ArchiveQuestionSetDto) {
    return this.setService.archive(id, dto);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.DELETE_AI_LAB],
  })
  @ApiOperation({
    summary:
      'Delete a draft question set (published sets must be archived instead)',
  })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.setService.remove(id);
  }
}
