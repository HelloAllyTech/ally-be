import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ScenarioSessionRecordingService } from '../service/scenario-session-recording.service';

@ApiTags('Learn')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/scenario-session',
  version: '1',
})
export class ScenarioSessionRecordingController {
  constructor(
    private readonly scenarioSessionRecordingService: ScenarioSessionRecordingService,
  ) {}

  @Get(':scenarioSessionId/recording')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS])
  async getScenarioSessionRecording(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
  ) {
    return this.scenarioSessionRecordingService.getScenarioSessionRecording(
      scenarioSessionId,
    );
  }
}
