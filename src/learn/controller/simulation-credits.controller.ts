import { Controller, Get, Body, Query, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SimulationCreditsService } from '../service/simulation-credits.service';
import { GetSimulationCreditsDto } from '../dto/get-simulation-credits.dto';
import { UpdateSimulationCreditsDto } from '../dto/update-simulation-credits.dto';
import { SimulationCreditsResponseDto } from '../dto/simulation-credits-response.dto';
import { TokenUser } from 'src/auth/type/auth.types';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  GetSimulationCreditsDocumentation,
  UpdateSimulationCreditsDocumentation,
} from '../decorator/api-documentation.decorator';

@ApiTags('Simulation Credits')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/simulation-credits')
export class SimulationCreditsController {
  constructor(
    private readonly simulationCreditsService: SimulationCreditsService,
  ) {}

  @GetSimulationCreditsDocumentation()
  @AuthPermissions([PERMISSIONS.VIEW_SIMULATION_CREDITS])
  @Get()
  async getSimulationCredits(
    @CurrentUser() tokenUser: TokenUser,
    @Query() query: GetSimulationCreditsDto,
  ): Promise<SimulationCreditsResponseDto> {
    return this.simulationCreditsService.getSimulationCredits(
      tokenUser.id,
      query.userId,
    );
  }

  @UpdateSimulationCreditsDocumentation()
  @AuthPermissions([PERMISSIONS.EDIT_SIMULATION_CREDITS])
  @Put()
  async updateSimulationCredits(
    @Body() body: UpdateSimulationCreditsDto,
  ): Promise<{ success: boolean }> {
    return this.simulationCreditsService.updateSimulationCredits(body);
  }
}
