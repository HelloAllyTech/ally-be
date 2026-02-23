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
import { BehaviorService } from '../service/behavior.service';
import {
  CreateBehaviorDto,
  CreateBehaviorResponseDto,
  CreateBehaviorsDto,
} from '../dto/create-behavior.dto';
import { GetBehaviorsResponseDto } from '../dto/behavior-response.dto';
import { BehaviorSortBy } from '../enum/behavior.enum';
import { SortOrder } from 'src/common/type/common.type';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { Behavior } from '../entity/behavior.entity';

@ApiTags('Behaviors')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/scenario-behaviors',
  version: '1',
})
export class BehaviorController {
  constructor(private readonly behaviorService: BehaviorService) {}

  @ApiOperation({ summary: 'Get all behaviors' })
  @ApiResponse({
    status: 200,
    description: 'List of behaviors retrieved successfully',
    type: GetBehaviorsResponseDto,
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
    enum: BehaviorSortBy,
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
  async getBehaviors(
    @Query('name') name?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy: BehaviorSortBy = BehaviorSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetBehaviorsResponseDto> {
    return this.behaviorService.getBehaviors(name, {
      offset,
      limit,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a new behavior' })
  @ApiResponse({
    status: 201,
    description: 'Behavior created successfully',
    type: CreateBehaviorResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post()
  async createBehavior(
    @CurrentUser() tokenUser: TokenUser,
    @Body() createBehaviorDto: CreateBehaviorDto,
  ): Promise<CreateBehaviorResponseDto> {
    return this.behaviorService.createBehavior(createBehaviorDto, tokenUser.id);
  }

  @ApiOperation({ summary: 'Bulk insertion of behaviors' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('bulk-insertions')
  async createBehaviors(
    @Body() createBehaviorsDto: CreateBehaviorsDto,
  ): Promise<{ behaviors: Behavior[] }> {
    return this.behaviorService.createBehaviors(createBehaviorsDto);
  }
}
