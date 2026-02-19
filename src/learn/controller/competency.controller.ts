import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CompetencyService } from '../service/competency.service';
import {
  CreateCompetencyDto,
  CreateCompetencyResponseDto,
} from '../dto/competency.dto';
import { GetCompetenciesResponseDto } from '../dto/competency.dto';
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
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get()
  async getAllCompetencies(
    @Query('name') name?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy: CompetencySortBy = CompetencySortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetCompetenciesResponseDto> {
    return this.competencyService.getCompetencies(name, {
      offset,
      limit,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a new competency' })
  @ApiResponse({
    status: 201,
    description: 'Competency created successfully',
    type: CreateCompetencyResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
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
}
