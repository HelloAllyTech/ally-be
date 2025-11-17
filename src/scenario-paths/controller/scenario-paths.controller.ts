import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CreateScenarioPathDto } from '../dto/create-scenario-path.dto';
import { ScenarioPathsService } from '../service/scenario-paths.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Learn Scenario Paths')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('learn/admin')
export class ScenarioPathsController {
  constructor(private readonly scenarioPathsService: ScenarioPathsService) {}

  @ApiOperation({ description: 'Create scenario path' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Post('scenario-paths')
  async createScenarioPath(
    @Body() createScenarioPathDto: CreateScenarioPathDto,
  ) {
    return this.scenarioPathsService.createScenarioPath(createScenarioPathDto);
  }
}
