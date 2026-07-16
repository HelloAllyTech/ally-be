import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';
import { LabVariableRepository } from '../repository/lab-variable.repository';
import { LabVariable } from '../entity/lab-variable.entity';
import {
  CreateLabVariableDto,
  UpdateLabVariableDto,
} from '../dto/lab-variable.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';

@Injectable()
export class LabVariableService {
  private readonly logger = LoggerService.getInstance(LabVariableService.name);

  constructor(private readonly variableRepository: LabVariableRepository) {}

  async list(
    query: LabListQueryDto,
  ): Promise<{ items: LabVariable[]; count: number }> {
    return this.variableRepository.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getById(id: string): Promise<LabVariable> {
    const variable = await this.variableRepository.findOne({ where: { id } });
    if (!variable) {
      throw new NotFoundException(`Variable with ID ${id} not found`);
    }
    return variable;
  }

  async create(dto: CreateLabVariableDto): Promise<LabVariable> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const variable = this.variableRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      createdBy: userId,
    });
    try {
      const saved = await this.variableRepository.save(variable);
      this.logger.info(`Lab variable created: ${saved.id}`);
      return saved;
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A variable named '${dto.name}' already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateLabVariableDto): Promise<LabVariable> {
    const variable = await this.getById(id);
    if (dto.name !== undefined) variable.name = dto.name;
    if (dto.description !== undefined) variable.description = dto.description;
    try {
      const saved = await this.variableRepository.save(variable);
      this.logger.info(`Lab variable updated: ${saved.id}`);
      return saved;
    } catch (error) {
      if (isDuplicateKeyException(error)) {
        throw new ConflictException(
          `A variable named '${dto.name}' already exists`,
        );
      }
      throw error;
    }
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    // lab_values has ON DELETE CASCADE on variable_id, so bound values go too.
    await this.variableRepository.delete(id);
    this.logger.info(`Lab variable deleted: ${id}`);
    return { success: true };
  }
}
