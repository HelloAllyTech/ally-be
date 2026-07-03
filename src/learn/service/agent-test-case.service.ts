import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentTestCaseRepository } from '../repository/agent-test-case.repository';
import {
  CreateAgentTestCaseDto,
  GetAgentTestCasesResponseDto,
  AgentTestCaseResponseDto,
  UpdateAgentTestCaseDto,
} from '../dto/agent-test-case.dto';
import { Pagination } from 'src/common/type/common.type';
import { AgentTestCase } from '../entity/agent-test-case.entity';

@Injectable()
export class AgentTestCaseService {
  constructor(
    private readonly agentTestCaseRepository: AgentTestCaseRepository,
  ) {}

  async createAgentTestCase(
    dto: CreateAgentTestCaseDto,
    createdBy?: number,
  ): Promise<AgentTestCaseResponseDto> {
    const goal = this.agentTestCaseRepository.create({
      ...dto,
      createdBy,
    });
    const saved = await this.agentTestCaseRepository.save(goal);
    return this.mapToResponseDto(saved);
  }

  async getAgentTestCases(
    search?: string,
    options?: Pagination,
  ): Promise<GetAgentTestCasesResponseDto> {
    const { data, count } =
      await this.agentTestCaseRepository.getAgentTestCases(search, options);
    return {
      data: data.map((goal) => this.mapToResponseDto(goal)),
      count,
    };
  }

  async getAgentTestCase(id: string): Promise<AgentTestCaseResponseDto> {
    const goal = await this.getOrThrow(id);
    return this.mapToResponseDto(goal);
  }

  async updateAgentTestCase(
    id: string,
    dto: UpdateAgentTestCaseDto,
  ): Promise<AgentTestCaseResponseDto> {
    const goal = await this.getOrThrow(id);
    Object.assign(goal, dto);
    const saved = await this.agentTestCaseRepository.save(goal);
    return this.mapToResponseDto(saved);
  }

  async deleteAgentTestCase(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.agentTestCaseRepository.delete(id);
  }

  private async getOrThrow(id: string): Promise<AgentTestCase> {
    const goal = await this.agentTestCaseRepository.getAgentTestCaseById(id);
    if (!goal) {
      throw new NotFoundException(`Agent test case with id ${id} not found`);
    }
    return goal;
  }

  private mapToResponseDto(goal: AgentTestCase): AgentTestCaseResponseDto {
    return {
      id: goal.id,
      title: goal.title,
      category: goal.category,
      description: goal.description,
      condition: goal.condition,
      test: goal.test,
    };
  }
}
