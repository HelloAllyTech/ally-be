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
import { AgentTestCaseType } from '../enum/agent-test-case.enum';

@Injectable()
export class AgentTestCaseService {
  constructor(
    private readonly agentTestCaseRepository: AgentTestCaseRepository,
  ) {}

  async createAgentTestCase(
    dto: CreateAgentTestCaseDto,
    createdBy?: number,
  ): Promise<AgentTestCaseResponseDto> {
    const entity = this.agentTestCaseRepository.create({ createdBy });
    this.applyDto(entity, dto);
    const saved = await this.agentTestCaseRepository.save(entity);
    return this.mapToResponseDto(saved);
  }

  async getAgentTestCases(
    search?: string,
    options?: Pagination,
  ): Promise<GetAgentTestCasesResponseDto> {
    const { data, count } =
      await this.agentTestCaseRepository.getAgentTestCases(search, options);
    return {
      data: data.map((testCase) => this.mapToResponseDto(testCase)),
      count,
    };
  }

  async getAgentTestCase(id: string): Promise<AgentTestCaseResponseDto> {
    const testCase = await this.getOrThrow(id);
    return this.mapToResponseDto(testCase);
  }

  async updateAgentTestCase(
    id: string,
    dto: UpdateAgentTestCaseDto,
  ): Promise<AgentTestCaseResponseDto> {
    const testCase = await this.getOrThrow(id);
    this.applyDto(testCase, dto);
    const saved = await this.agentTestCaseRepository.save(testCase);
    return this.mapToResponseDto(saved);
  }

  async deleteAgentTestCase(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.agentTestCaseRepository.delete(id);
  }

  private async getOrThrow(id: string): Promise<AgentTestCase> {
    const testCase =
      await this.agentTestCaseRepository.getAgentTestCaseById(id);
    if (!testCase) {
      throw new NotFoundException(`Agent test case with id ${id} not found`);
    }
    return testCase;
  }

  /**
   * Merge the DTO onto the entity and normalise by type so the two variants
   * never carry each other's stale fields: condition tests keep condition/test
   * and clear rubrics; full-session tests keep rubrics and clear condition/test.
   */
  private applyDto(
    entity: AgentTestCase,
    dto: CreateAgentTestCaseDto | UpdateAgentTestCaseDto,
  ): void {
    const type = dto.type ?? entity.type ?? AgentTestCaseType.CONDITION;

    if (dto.title !== undefined) entity.title = dto.title;
    entity.type = type;
    if (dto.tags !== undefined) entity.tags = dto.tags;
    if (entity.tags === undefined || entity.tags === null) entity.tags = [];
    if (dto.description !== undefined) entity.description = dto.description;

    if (type === AgentTestCaseType.CONDITION) {
      entity.condition = dto.condition ?? entity.condition ?? null;
      entity.test = dto.test ?? entity.test ?? null;
      entity.rubrics = null;
    } else {
      entity.rubrics = (dto.rubrics ?? entity.rubrics ?? []).map((r) => ({
        criteria: r.criteria,
        scoringInstructions: r.scoringInstructions,
      }));
      entity.condition = null;
      entity.test = null;
    }
  }

  private mapToResponseDto(testCase: AgentTestCase): AgentTestCaseResponseDto {
    return {
      id: testCase.id,
      title: testCase.title,
      type: testCase.type,
      tags: testCase.tags ?? [],
      description: testCase.description ?? undefined,
      condition: testCase.condition ?? undefined,
      test: testCase.test ?? undefined,
      rubrics: testCase.rubrics ?? undefined,
    };
  }
}
