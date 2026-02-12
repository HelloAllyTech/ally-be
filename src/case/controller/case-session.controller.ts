import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CaseSessionsResponseDto } from '../dto/case-session.dto';
import { CaseSessionSortBy } from '../type/case-session-items.type';
import { SortOrder } from 'src/common/type/common.type';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CaseSessionService } from '../service/case-session.service';
import { CreateCaseSessionResponseDto } from '../dto/create-case-item.dto';
import { GetUpcomingCaseItemResponseDto } from '../dto/get-case.dto';
import { UPCOMING_CASE_ITEM_EXAMPLE } from '../constants/case.constant';

@ApiTags('Cases')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn')
export class CaseSessionController {
  constructor(private readonly caseSessionService: CaseSessionService) {}

  @ApiOperation({ summary: 'Get case sessions' })
  @ApiResponse({
    status: 200,
    description: 'Case sessions retrieved successfully',
    type: CaseSessionsResponseDto,
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
    enum: CaseSessionSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthPermissions([PERMISSIONS.VIEW_CASES])
  @Get('/case-sessions')
  async getUserCaseSessions(
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy')
    sortBy: CaseSessionSortBy = CaseSessionSortBy.UPDATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<CaseSessionsResponseDto> {
    return this.caseSessionService.getUserCaseSessions({
      offset,
      limit,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Get case session by case id' })
  @AuthPermissions([PERMISSIONS.VIEW_CASE])
  @Get('cases/:id')
  async getUserCaseItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.caseSessionService.getUserCaseItems(id);
  }

  @ApiOperation({ summary: 'Create Scenario path session for user' })
  @ApiResponse({
    status: 200,
    type: CreateCaseSessionResponseDto,
    example: {
      caseSessionItemId: '123',
    },
  })
  @AuthPermissions([PERMISSIONS.EDIT_CASE])
  @Post('/cases/:caseId/create-session')
  async createCaseSession(
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<CreateCaseSessionResponseDto> {
    return this.caseSessionService.createUserCaseSession(caseId);
  }

  @ApiOperation({ summary: 'Get upcoming scenario' })
  @ApiResponse({
    status: 200,
    description: 'Upcoming case item retrieved successfully',
    type: GetUpcomingCaseItemResponseDto,
    example: UPCOMING_CASE_ITEM_EXAMPLE,
  })
  @AuthPermissions([PERMISSIONS.VIEW_CASE])
  @Get('/cases/:scenarioSessionId/upcoming-scenario')
  async getUpcomingCaseItem(
    @Param('scenarioSessionId', ParseUUIDPipe)
    scenarioSessionId: string,
  ): Promise<GetUpcomingCaseItemResponseDto | null> {
    return await this.caseSessionService.getNextCaseItem(scenarioSessionId);
  }
}
