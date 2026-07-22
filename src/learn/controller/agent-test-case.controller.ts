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
import { AgentTestCaseService } from '../service/agent-test-case.service';
import {
  CreateAgentTestCaseDto,
  GetAgentTestCasesResponseDto,
  AgentTestCaseResponseDto,
  UpdateAgentTestCaseDto,
} from '../dto/agent-test-case.dto';
import { AgentTestCaseSortBy } from '../enum/agent-test-case.enum';
import { SortOrder } from 'src/common/type/common.type';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Agent Test Cases')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/agent-test-cases',
  version: '1',
})
export class AgentTestCaseController {
  constructor(private readonly agentTestCaseService: AgentTestCaseService) {}

  @ApiOperation({ summary: 'Get all agent test cases' })
  @ApiResponse({
    status: 200,
    description: 'List of agent test cases retrieved successfully',
    type: GetAgentTestCasesResponseDto,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Filter by title or tags',
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
    enum: AgentTestCaseSortBy,
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
  async getAllAgentTestCases(
    @Query('search') search?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy')
    sortBy: AgentTestCaseSortBy = AgentTestCaseSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetAgentTestCasesResponseDto> {
    return this.agentTestCaseService.getAgentTestCases(search, {
      offset,
      limit,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a new agent test case' })
  @ApiResponse({
    status: 201,
    description: 'Agent test case created successfully',
    type: AgentTestCaseResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post()
  async createAgentTestCase(
    @CurrentUser() tokenUser: TokenUser,
    @Body() dto: CreateAgentTestCaseDto,
  ): Promise<AgentTestCaseResponseDto> {
    return this.agentTestCaseService.createAgentTestCase(dto, tokenUser.id);
  }

  @ApiOperation({ summary: 'Update an agent test case' })
  @ApiResponse({
    status: 200,
    description: 'Agent test case updated successfully',
    type: AgentTestCaseResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put(':id')
  async updateAgentTestCase(
    @Param('id') id: string,
    @Body() dto: UpdateAgentTestCaseDto,
  ): Promise<AgentTestCaseResponseDto> {
    return this.agentTestCaseService.updateAgentTestCase(id, dto);
  }

  @ApiOperation({ summary: 'Delete an agent test case' })
  @ApiResponse({
    status: 200,
    description: 'Agent test case deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Delete(':id')
  async deleteAgentTestCase(@Param('id') id: string): Promise<void> {
    return this.agentTestCaseService.deleteAgentTestCase(id);
  }
}
