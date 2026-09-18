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
import { CompetencyService } from '../service/competency.service';
import {
  CreateCompetencyDto,
  CreateCompetencyResponseDto,
  CompetencyResponseDto,
  UpdateCompetencyDto,
} from '../dto/competency.dto';
import { GetCompetenciesResponseDto } from '../dto/competency.dto';
import {
  CompetencyBehavioursResponseDto,
  SetCompetencyBehavioursDto,
} from '../dto/competency-behavior.dto';
import { CompetencySortBy } from '../enum/competency.enum';
import { SortOrder } from 'src/common/type/common.type';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Competencies')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/competencies',
  version: '1',
})
export class CompetencyController {
  constructor(private readonly competencyService: CompetencyService) {}

  @ApiOperation({ summary: 'Get all competencies' })
  @ApiResponse({
    status: 200,
    description: 'List of competencies retrieved successfully',
    type: GetCompetenciesResponseDto,
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Filter by name',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: CompetencySortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @ApiQuery({
    name: 'includeOwnCustom',
    required: false,
    type: Boolean,
    description:
      "Include the requester's own custom competencies alongside the global " +
      'ones (defaults to false — custom competencies are otherwise hidden).',
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Get()
  async getAllCompetencies(
    @CurrentUser() tokenUser: TokenUser,
    @Query('name') name?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy: CompetencySortBy = CompetencySortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
    @Query('includeOwnCustom') includeOwnCustom?: string,
  ): Promise<GetCompetenciesResponseDto> {
    return this.competencyService.getCompetencies(
      name,
      {
        offset,
        limit,
        sortBy,
        order,
      },
      {
        includeOwnCustom: includeOwnCustom === 'true',
        userId: tokenUser.id,
      },
    );
  }

  @ApiOperation({ summary: 'Create a new competency' })
  @ApiResponse({
    status: 201,
    description: 'Competency created successfully',
    type: CreateCompetencyResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Post()
  async createCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Body() createCompetencyDto: CreateCompetencyDto,
  ): Promise<CreateCompetencyResponseDto> {
    return this.competencyService.createCompetency(
      createCompetencyDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Update a competency' })
  @ApiResponse({
    status: 200,
    description: 'Competency updated successfully',
    type: CompetencyResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Put(':id')
  async updateCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Body() updateCompetencyDto: UpdateCompetencyDto,
  ): Promise<CompetencyResponseDto> {
    return this.competencyService.updateCompetency(
      id,
      updateCompetencyDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Delete a competency' })
  @ApiResponse({
    status: 200,
    description: 'Competency deleted successfully',
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Delete(':id')
  async deleteCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.competencyService.deleteCompetency(id, tokenUser.id);
  }

  @ApiOperation({
    summary: 'Get the helpful/unhelpful behaviours for a competency',
  })
  @ApiResponse({
    status: 200,
    description: 'Competency behaviours retrieved successfully',
    type: CompetencyBehavioursResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Get(':id/behaviours')
  async getCompetencyBehaviours(
    @Param('id') id: string,
  ): Promise<CompetencyBehavioursResponseDto> {
    return this.competencyService.getCompetencyBehaviours(id);
  }

  @ApiOperation({
    summary: 'Set the helpful/unhelpful behaviours for a competency',
  })
  @ApiResponse({
    status: 200,
    description: 'Competency behaviours updated successfully',
    type: CompetencyBehavioursResponseDto,
  })
  @RequireFeatureToggle(FeatureToggleKey.COMPETENCIES, {
    permissions: [PERMISSIONS.EDIT_SCENARIO],
  })
  @Put(':id/behaviours')
  async setCompetencyBehaviours(
    @Param('id') id: string,
    @Body() dto: SetCompetencyBehavioursDto,
  ): Promise<CompetencyBehavioursResponseDto> {
    return this.competencyService.setCompetencyBehaviours(id, dto);
  }
}
