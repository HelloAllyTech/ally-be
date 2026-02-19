import { Injectable, NotFoundException } from '@nestjs/common';
import { CompetencyRepository } from '../repository/competency.repository';
import {
  CreateCompetencyDto,
  CreateCompetencyResponseDto,
} from '../dto/competency.dto';
import {
  GetCompetenciesResponseDto,
  CompetencyResponseDto,
} from '../dto/competency.dto';
import { Pagination } from 'src/common/type/common.type';
import { Competency } from '../entity/competency.entity';

@Injectable()
export class CompetencyService {
  constructor(private readonly competencyRepository: CompetencyRepository) {}

  async createCompetency(
    createCompetencyDto: CreateCompetencyDto,
    createdBy?: number,
  ): Promise<CreateCompetencyResponseDto> {
    const competency = this.competencyRepository.create({
      ...createCompetencyDto,
      createdBy,
    });
    const saved = await this.competencyRepository.save(competency);
    return {
      id: saved.id,
      name: saved.name,
    };
  }

  async getCompetencies(
    name?: string,
    options?: Pagination,
  ): Promise<GetCompetenciesResponseDto> {
    const { data, count } = await this.competencyRepository.getCompetencies(
      name,
      options,
    );
    return {
      data: data.map((c) => this.mapToResponseDto(c)),
      count,
    };
  }

  async getCompetency(id: string): Promise<CompetencyResponseDto> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
    return this.mapToResponseDto(competency);
  }

  async validateCompetencyId(id: string): Promise<void> {
    const competency = await this.competencyRepository.getCompetencyById(id);
    if (!competency) {
      throw new NotFoundException(`Competency with id ${id} not found`);
    }
  }

  private mapToResponseDto(competency: Competency): CompetencyResponseDto {
    return {
      id: competency.id,
      name: competency.name,
    };
  }
}
