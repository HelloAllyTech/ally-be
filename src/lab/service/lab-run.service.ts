import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LabRunRepository } from '../repository/lab-run.repository';
import { LabSkillRepository } from '../repository/lab-skill.repository';
import { LabRun, LabRunStatus } from '../entity/lab-run.entity';
import { CreateLabRunDto } from '../dto/lab-run.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';

const RUN_MAX_TOKENS = 2048;
const RUN_TIMEOUT_MS = 90_000;

/** Escape a variable name for safe use inside a RegExp. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class LabRunService {
  private readonly logger = LoggerService.getInstance(LabRunService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly runRepository: LabRunRepository,
    private readonly skillRepository: LabSkillRepository,
    private readonly configService: AppConfigService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  async list(
    query: LabListQueryDto,
  ): Promise<{ items: LabRun[]; count: number }> {
    return this.runRepository.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getById(id: string): Promise<LabRun> {
    const run = await this.runRepository.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Run with ID ${id} not found`);
    }
    return run;
  }

  /**
   * Substitute `{{name}}` (whitespace-tolerant) placeholders in the skill's
   * content with the supplied values.
   */
  private resolvePrompt(
    content: string,
    values: { name: string; value: string }[],
  ): string {
    let resolved = content;
    for (const { name, value } of values) {
      const pattern = new RegExp(
        `\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`,
        'g',
      );
      resolved = resolved.replace(pattern, value);
    }
    return resolved;
  }

  /**
   * Run a single skill: resolve its prompt, persist a RUNNING row, call the
   * LLM, then flip the row to COMPLETED (with output) or FAILED (with error).
   * Always returns the row — a failed LLM call is a FAILED row, not a thrown
   * error — so the runs log reflects every attempt.
   */
  async create(dto: CreateLabRunDto): Promise<LabRun> {
    const skill = await this.skillRepository.findOne({
      where: { id: dto.skillId },
    });
    if (!skill) {
      throw new NotFoundException(`Skill with ID ${dto.skillId} not found`);
    }

    const values = dto.variableValues ?? [];
    const resolvedPrompt = this.resolvePrompt(skill.content, values);
    const userId = Number(ExecutionManager.getUserId() ?? 0);

    let run = this.runRepository.create({
      batchId: dto.batchId ?? null,
      skillId: skill.id,
      skillName: skill.name,
      resolvedPrompt,
      variableValues: values.map((v) => ({ name: v.name, value: v.value })),
      model: this.model,
      status: LabRunStatus.RUNNING,
      createdBy: userId,
    });
    run = await this.runRepository.save(run);

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: RUN_MAX_TOKENS,
          messages: [{ role: 'user', content: resolvedPrompt }],
        },
        { timeout: RUN_TIMEOUT_MS },
      );
      const block = response.content[0];
      const text = block?.type === 'text' ? block.text : '';
      run.output = text;
      run.status = LabRunStatus.COMPLETED;
      this.logger.info(`[AI_LAB] run ${run.id} completed (skill=${skill.id})`);
    } catch (error) {
      run.status = LabRunStatus.FAILED;
      run.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AI_LAB] run ${run.id} failed: ${run.error}`);
    }

    return this.runRepository.save(run);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    await this.runRepository.delete(id);
    this.logger.info(`Lab run deleted: ${id}`);
    return { success: true };
  }
}
