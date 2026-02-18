import { Injectable, NotFoundException } from '@nestjs/common';
import { BehaviorRepository } from '../repository/behavior.repository';
import {
  CreateBehaviorDto,
  CreateBehaviorResponseDto,
} from '../dto/create-behavior.dto';
import {
  GetBehaviorsResponseDto,
  BehaviorResponseDto,
} from '../dto/behavior-response.dto';
import { Pagination } from 'src/common/type/common.type';
import { Behavior } from '../entity/behavior.entity';

@Injectable()
export class BehaviorService {
  constructor(private readonly behaviorRepository: BehaviorRepository) {}

  async createBehavior(
    createBehaviorDto: CreateBehaviorDto,
    createdBy?: number,
  ): Promise<CreateBehaviorResponseDto> {
    const behavior = this.behaviorRepository.create({
      ...createBehaviorDto,
      createdBy,
    });
    const saved = await this.behaviorRepository.save(behavior);
    return {
      id: saved.id,
      name: saved.name,
      createdBy: saved.createdBy,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async getBehaviors(
    name?: string,
    options?: Pagination,
  ): Promise<GetBehaviorsResponseDto> {
    const { data, count } = await this.behaviorRepository.getBehaviors(
      name,
      options,
    );
    return {
      data: data.map((b) => this.mapToResponseDto(b)),
      count,
    };
  }

  async validateBehaviorIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const behaviors = await this.behaviorRepository.getBehaviorsByIds(ids);
    const foundIds = new Set(behaviors.map((b) => b.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Behaviors with ids ${missingIds.join(', ')} not found`,
      );
    }
  }

  private mapToResponseDto(behavior: Behavior): BehaviorResponseDto {
    return {
      id: behavior.id,
      name: behavior.name,
    };
  }
}
