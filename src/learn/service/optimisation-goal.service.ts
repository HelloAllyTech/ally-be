import { Injectable, NotFoundException } from '@nestjs/common';
import { OptimisationGoalRepository } from '../repository/optimisation-goal.repository';
import {
  CreateOptimisationGoalDto,
  GetOptimisationGoalsResponseDto,
  OptimisationGoalResponseDto,
  UpdateOptimisationGoalDto,
} from '../dto/optimisation-goal.dto';
import { Pagination } from 'src/common/type/common.type';
import { OptimisationGoal } from '../entity/optimisation-goal.entity';

@Injectable()
export class OptimisationGoalService {
  constructor(
    private readonly optimisationGoalRepository: OptimisationGoalRepository,
  ) {}

  async createOptimisationGoal(
    dto: CreateOptimisationGoalDto,
    createdBy?: number,
  ): Promise<OptimisationGoalResponseDto> {
    const goal = this.optimisationGoalRepository.create({
      ...dto,
      createdBy,
    });
    const saved = await this.optimisationGoalRepository.save(goal);
    return this.mapToResponseDto(saved);
  }

  async getOptimisationGoals(
    search?: string,
    options?: Pagination,
  ): Promise<GetOptimisationGoalsResponseDto> {
    const { data, count } =
      await this.optimisationGoalRepository.getOptimisationGoals(
        search,
        options,
      );
    return {
      data: data.map((goal) => this.mapToResponseDto(goal)),
      count,
    };
  }

  async getOptimisationGoal(id: string): Promise<OptimisationGoalResponseDto> {
    const goal = await this.getOrThrow(id);
    return this.mapToResponseDto(goal);
  }

  async updateOptimisationGoal(
    id: string,
    dto: UpdateOptimisationGoalDto,
  ): Promise<OptimisationGoalResponseDto> {
    const goal = await this.getOrThrow(id);
    Object.assign(goal, dto);
    const saved = await this.optimisationGoalRepository.save(goal);
    return this.mapToResponseDto(saved);
  }

  async deleteOptimisationGoal(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.optimisationGoalRepository.delete(id);
  }

  private async getOrThrow(id: string): Promise<OptimisationGoal> {
    const goal =
      await this.optimisationGoalRepository.getOptimisationGoalById(id);
    if (!goal) {
      throw new NotFoundException(`Optimisation goal with id ${id} not found`);
    }
    return goal;
  }

  private mapToResponseDto(
    goal: OptimisationGoal,
  ): OptimisationGoalResponseDto {
    return {
      id: goal.id,
      title: goal.title,
      category: goal.category,
      description: goal.description,
    };
  }
}
