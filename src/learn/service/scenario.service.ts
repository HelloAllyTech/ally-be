import { Injectable, NotFoundException } from '@nestjs/common';
import { DeepPartial, Repository } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ScenarioResponse } from '../dto/scenario-response.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';

@Injectable()
export class ScenarioService {
  constructor(
    @InjectRepository(Scenarios)
    private scenarioRepository: Repository<Scenarios>,
  ) {}

  async getScenarios(): Promise<ScenarioResponse[]> {
    return this.scenarioRepository.find({
      select: [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'status',
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getScenario(id: number): Promise<ScenarioResponse> {
    const scenario = await this.scenarioRepository.findOne({
      select: [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'status',
      ],
      where: { id },
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    return scenario;
  }

  async createScenarios(
    createScenariosDto: CreateScenariosDto,
  ): Promise<Scenarios[]> {
    const scenarios = this.scenarioRepository.create(
      createScenariosDto.scenarios as DeepPartial<Scenarios>[],
    );
    return this.scenarioRepository.save(scenarios);
  }

  async updateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
  ): Promise<boolean> {
    const scenario = await this.scenarioRepository.findOne({ where: { id } });
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    const updated = await this.scenarioRepository.update(
      id,
      updateScenarioDto as DeepPartial<Scenarios>,
    );
    return updated.affected !== 0;
  }
}
