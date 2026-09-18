import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { CompetencyClusterService } from '../service/competency-cluster.service';
import {
  CompetencyClusterResponseDto,
  CreateCompetencyClusterDto,
  GetCompetencyClustersResponseDto,
  UpdateCompetencyClusterDto,
} from '../dto/competency-cluster.dto';

@ApiTags('Competency clusters')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/competency-clusters',
  version: '1',
})
export class CompetencyClusterController {
  constructor(private readonly clusterService: CompetencyClusterService) {}

  @ApiOperation({
    summary: 'Get all competency clusters with their member competencies',
  })
  @ApiResponse({
    status: 200,
    description: 'List of clusters retrieved successfully',
    type: GetCompetencyClustersResponseDto,
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Filter by name',
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Get()
  async getClusters(
    @Query('name') name?: string,
  ): Promise<GetCompetencyClustersResponseDto> {
    return this.clusterService.getClusters(name);
  }

  @ApiOperation({ summary: 'Create a competency cluster' })
  @ApiResponse({
    status: 201,
    description: 'Cluster created successfully',
    type: CompetencyClusterResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Post()
  async createCluster(
    @CurrentUser() tokenUser: TokenUser,
    @Body() dto: CreateCompetencyClusterDto,
  ): Promise<CompetencyClusterResponseDto> {
    return this.clusterService.createCluster(dto, tokenUser.id);
  }

  @ApiOperation({ summary: 'Rename a cluster and/or replace its membership' })
  @ApiResponse({
    status: 200,
    description: 'Cluster updated successfully',
    type: CompetencyClusterResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Put(':id')
  async updateCluster(
    @Param('id') id: string,
    @Body() dto: UpdateCompetencyClusterDto,
  ): Promise<CompetencyClusterResponseDto> {
    return this.clusterService.updateCluster(id, dto);
  }

  @ApiOperation({ summary: 'Delete a cluster' })
  @ApiResponse({ status: 200, description: 'Cluster deleted successfully' })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Delete(':id')
  async deleteCluster(@Param('id') id: string): Promise<void> {
    return this.clusterService.deleteCluster(id);
  }
}
