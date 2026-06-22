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
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { OptimisationGoalService } from '../service/optimisation-goal.service';
import {
  CreateOptimisationGoalDto,
  GetOptimisationGoalsResponseDto,
  OptimisationGoalResponseDto,
  UpdateOptimisationGoalDto,
} from '../dto/optimisation-goal.dto';
import { OptimisationGoalSortBy } from '../enum/optimisation-goal.enum';
import { SortOrder } from 'src/common/type/common.type';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Optimisation Goals')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/optimisation-goals',
  version: '1',
})
export class OptimisationGoalController {
  constructor(
    private readonly optimisationGoalService: OptimisationGoalService,
  ) {}

  @ApiOperation({ summary: 'Get all optimisation goals' })
  @ApiResponse({
    status: 200,
    description: 'List of optimisation goals retrieved successfully',
    type: GetOptimisationGoalsResponseDto,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Filter by title or category',
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
    enum: OptimisationGoalSortBy,
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
  async getAllOptimisationGoals(
    @Query('search') search?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy')
    sortBy: OptimisationGoalSortBy = OptimisationGoalSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetOptimisationGoalsResponseDto> {
    return this.optimisationGoalService.getOptimisationGoals(search, {
      offset,
      limit,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a new optimisation goal' })
  @ApiResponse({
    status: 201,
    description: 'Optimisation goal created successfully',
    type: OptimisationGoalResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post()
  async createOptimisationGoal(
    @CurrentUser() tokenUser: TokenUser,
    @Body() dto: CreateOptimisationGoalDto,
  ): Promise<OptimisationGoalResponseDto> {
    return this.optimisationGoalService.createOptimisationGoal(
      dto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Update an optimisation goal' })
  @ApiResponse({
    status: 200,
    description: 'Optimisation goal updated successfully',
    type: OptimisationGoalResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put(':id')
  async updateOptimisationGoal(
    @Param('id') id: string,
    @Body() dto: UpdateOptimisationGoalDto,
  ): Promise<OptimisationGoalResponseDto> {
    return this.optimisationGoalService.updateOptimisationGoal(id, dto);
  }

  @ApiOperation({ summary: 'Delete an optimisation goal' })
  @ApiResponse({
    status: 200,
    description: 'Optimisation goal deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Delete(':id')
  async deleteOptimisationGoal(@Param('id') id: string): Promise<void> {
    return this.optimisationGoalService.deleteOptimisationGoal(id);
  }
}
