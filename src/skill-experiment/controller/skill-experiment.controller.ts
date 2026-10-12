import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SkillExperimentService } from '../service/skill-experiment.service';
import {
  ConfigureSkillExperimentDto,
  SkillExperimentObservationsQueryDto,
} from '../dto/skill-experiment.dto';

/**
 * Admin surface for auto-improve. Keyed by the skill (`prompts.id`), since an
 * admin arrives from a skill and each skill has at most one experiment.
 */
@ApiTags('Skill experiments')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'skill-experiments', version: '1' })
export class SkillExperimentController {
  constructor(private readonly service: SkillExperimentService) {}

  @ApiOperation({
    summary: 'Every skill connected to auto-improve, with its experiment state',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SKILL_EXPERIMENT])
  @Get()
  async list() {
    return this.service.listConnected();
  }

  @ApiOperation({
    summary: "One skill's experiment: config, variants, timeline, spend",
  })
  @AuthPermissions([PERMISSIONS.VIEW_SKILL_EXPERIMENT])
  @Get(':promptId')
  async get(@Param('promptId', ParseUUIDPipe) promptId: string) {
    return this.service.getDetail(promptId);
  }

  @ApiOperation({ summary: 'Create or update the rubric and thresholds' })
  @AuthPermissions([PERMISSIONS.EDIT_SKILL_EXPERIMENT])
  @Put(':promptId')
  async configure(
    @Param('promptId', ParseUUIDPipe) promptId: string,
    @Body() dto: ConfigureSkillExperimentDto,
  ) {
    await this.service.configure(promptId, dto);
    return this.service.getDetail(promptId);
  }

  @ApiOperation({ summary: 'Turn auto-improve on (starts a baseline run)' })
  @AuthPermissions([PERMISSIONS.EDIT_SKILL_EXPERIMENT])
  @Post(':promptId/start')
  async start(@Param('promptId', ParseUUIDPipe) promptId: string) {
    return this.service.start(promptId);
  }

  @ApiOperation({
    summary: 'Turn auto-improve off (the skill serves its own text)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SKILL_EXPERIMENT])
  @Post(':promptId/stop')
  async stop(@Param('promptId', ParseUUIDPipe) promptId: string) {
    return this.service.stop(promptId);
  }

  @ApiOperation({
    summary: 'Resume a paused experiment with a fresh variant budget',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SKILL_EXPERIMENT])
  @Post(':promptId/resume')
  async resume(@Param('promptId', ParseUUIDPipe) promptId: string) {
    return this.service.resume(promptId);
  }

  @ApiOperation({
    summary:
      'Apply the best version to the skill as a new version and end the experiment',
  })
  @AuthPermissions(
    [PERMISSIONS.EDIT_SKILL_EXPERIMENT, PERMISSIONS.EDIT_PROMPT],
    'AND',
  )
  @Post(':promptId/apply')
  async apply(@Param('promptId', ParseUUIDPipe) promptId: string) {
    return this.service.apply(promptId);
  }

  @ApiOperation({ summary: 'Judged outputs, newest first' })
  @AuthPermissions([PERMISSIONS.VIEW_SKILL_EXPERIMENT])
  @Get(':promptId/observations')
  async observations(
    @Param('promptId', ParseUUIDPipe) promptId: string,
    @Query() query: SkillExperimentObservationsQueryDto,
  ) {
    return this.service.listObservations(promptId, query);
  }
}
