import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { LabValueRepository } from '../repository/lab-value.repository';
import { LabVariableRepository } from '../repository/lab-variable.repository';
import { LabValue } from '../entity/lab-value.entity';
import { CreateLabValueDto, UpdateLabValueDto } from '../dto/lab-value.dto';
import { LabValueListQueryDto } from '../dto/lab-query.dto';

@Injectable()
export class LabValueService {
  private readonly logger = LoggerService.getInstance(LabValueService.name);

  constructor(
    private readonly valueRepository: LabValueRepository,
    private readonly variableRepository: LabVariableRepository,
  ) {}

  async list(
    query: LabValueListQueryDto,
  ): Promise<{ items: LabValue[]; count: number }> {
    return this.valueRepository.list({
      search: query.search,
      variableId: query.variableId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getById(id: string): Promise<LabValue> {
    const value = await this.valueRepository.findOne({
      where: { id },
      relations: { variable: true },
    });
    if (!value) {
      throw new NotFoundException(`Value with ID ${id} not found`);
    }
    return value;
  }

  private async assertVariableExists(variableId: string): Promise<void> {
    const exists = await this.variableRepository.findOne({
      where: { id: variableId },
    });
    if (!exists) {
      throw new BadRequestException(
        `Variable with ID ${variableId} does not exist`,
      );
    }
  }

  async create(dto: CreateLabValueDto): Promise<LabValue> {
    await this.assertVariableExists(dto.variableId);
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const value = this.valueRepository.create({
      variableId: dto.variableId,
      label: dto.label ?? null,
      value: dto.value,
      createdBy: userId,
    });
    const saved = await this.valueRepository.save(value);
    this.logger.info(`Lab value created: ${saved.id}`);
    return this.getById(saved.id);
  }

  async update(id: string, dto: UpdateLabValueDto): Promise<LabValue> {
    const value = await this.getById(id);
    if (dto.variableId !== undefined && dto.variableId !== value.variableId) {
      await this.assertVariableExists(dto.variableId);
      value.variableId = dto.variableId;
    }
    if (dto.label !== undefined) value.label = dto.label;
    if (dto.value !== undefined) value.value = dto.value;
    await this.valueRepository.save(value);
    this.logger.info(`Lab value updated: ${id}`);
    return this.getById(id);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    await this.valueRepository.delete(id);
    this.logger.info(`Lab value deleted: ${id}`);
    return { success: true };
  }
}
