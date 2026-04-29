import { ConflictException, Injectable } from '@nestjs/common';
import { TooltipRepository } from '../repository/tooltip.repository';
import { CreateTooltipDto } from '../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../dto/update-tooltip.dto';
import { Tooltip } from '../entity/tooltip.entity';
import isDuplicateKeyException, {
  NotFoundException,
} from 'src/exception/custom.exception';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';

@Injectable()
export class TooltipService {
  constructor(private readonly tooltipRepository: TooltipRepository) {}

  async createTooltip(createTooltipDto: CreateTooltipDto): Promise<Tooltip> {
    const userId = Number(ExecutionManager.getUserId());

    const tooltip = this.tooltipRepository.create({
      ...createTooltipDto,
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      return await this.tooltipRepository.save(tooltip);
    } catch (e) {
      if (isDuplicateKeyException(e)) {
        throw new ConflictException(
          `A tooltip for location "${createTooltipDto.location}" already exists`,
        );
      }
      throw e;
    }
  }

  async updateTooltip(
    id: string,
    updateTooltipDto: UpdateTooltipDto,
  ): Promise<boolean> {
    const tooltip = await this.tooltipRepository.findOne({ where: { id } });

    if (!tooltip) {
      throw new NotFoundException('Tooltip not found');
    }

    const userId = Number(ExecutionManager.getUserId());

    try {
      const result = await this.tooltipRepository.update(id, {
        ...updateTooltipDto,
        updatedBy: userId,
      });
      return result.affected !== 0;
    } catch (e) {
      if (isDuplicateKeyException(e)) {
        throw new ConflictException(
          `A tooltip for location "${updateTooltipDto.location}" already exists`,
        );
      }
      throw e;
    }
  }

  async getTooltips(search?: string, options?: Pagination): Promise<Tooltip[]> {
    return this.tooltipRepository.getTooltips(search, options);
  }
}
