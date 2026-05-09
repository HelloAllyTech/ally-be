import { ConflictException, Injectable } from '@nestjs/common';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import isDuplicateKeyException, {
  NotFoundException,
} from 'src/exception/custom.exception';

import { CreateTooltipDto } from '../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../dto/update-tooltip.dto';
import { Tooltip } from '../entity/tooltip.entity';
import { TooltipRepository } from '../repository/tooltip.repository';

interface TooltipQueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
}

@Injectable()
export class TooltipService {
  constructor(private readonly tooltipRepository: TooltipRepository) {}

  async createTooltip(createDto: CreateTooltipDto): Promise<Tooltip> {
    const userId = parseInt(ExecutionManager.getUserId() || '0', 10);
    const tooltip = this.tooltipRepository.create({
      ...createDto,
      createdBy: userId,
      updatedBy: userId,
    });
    try {
      return await this.tooltipRepository.save(tooltip);
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A tooltip for location '${createDto.location}' already exists`,
        );
      }
      throw error;
    }
  }

  async updateTooltip(
    id: string,
    updateDto: UpdateTooltipDto,
  ): Promise<boolean> {
    const existing = await this.tooltipRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Tooltip not found');

    const userId = parseInt(ExecutionManager.getUserId() || '0', 10);
    try {
      const result = await this.tooltipRepository.update(id, {
        ...updateDto,
        updatedBy: userId,
      });
      return (result.affected ?? 0) > 0;
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A tooltip for location '${updateDto.location}' already exists`,
        );
      }
      throw error;
    }
  }

  async getTooltips(
    search?: string,
    options?: TooltipQueryOptions,
  ): Promise<Tooltip[]> {
    return this.tooltipRepository.getTooltips(search, options);
  }
}
