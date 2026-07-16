import { Injectable, NotFoundException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { LabSkillRepository } from '../repository/lab-skill.repository';
import { LabSkill } from '../entity/lab-skill.entity';
import { CreateLabSkillDto, UpdateLabSkillDto } from '../dto/lab-skill.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';

@Injectable()
export class LabSkillService {
  private readonly logger = LoggerService.getInstance(LabSkillService.name);

  constructor(private readonly skillRepository: LabSkillRepository) {}

  async list(
    query: LabListQueryDto,
  ): Promise<{ items: LabSkill[]; count: number }> {
    return this.skillRepository.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getById(id: string): Promise<LabSkill> {
    const skill = await this.skillRepository.findOne({ where: { id } });
    if (!skill) {
      throw new NotFoundException(`Skill with ID ${id} not found`);
    }
    return skill;
  }

  async create(dto: CreateLabSkillDto): Promise<LabSkill> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const skill = this.skillRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      content: dto.content,
      createdBy: userId,
    });
    const saved = await this.skillRepository.save(skill);
    this.logger.info(`Lab skill created: ${saved.id}`);
    return saved;
  }

  async update(id: string, dto: UpdateLabSkillDto): Promise<LabSkill> {
    const skill = await this.getById(id);
    if (dto.name !== undefined) skill.name = dto.name;
    if (dto.description !== undefined) skill.description = dto.description;
    if (dto.content !== undefined) skill.content = dto.content;
    const saved = await this.skillRepository.save(skill);
    this.logger.info(`Lab skill updated: ${saved.id}`);
    return saved;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    await this.skillRepository.delete(id);
    this.logger.info(`Lab skill deleted: ${id}`);
    return { success: true };
  }
}
