import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSettings } from '../entity/builder-settings.entity';

/**
 * The singleton settings row: the kill switch, the concurrency ceiling and
 * the default budget.
 *
 * Separate from BuilderBuildService so the switch can be read from anywhere
 * without pulling in the dispatcher — and so "is Builder on?" has exactly one
 * answer.
 */
@Injectable()
export class BuilderSettingsService {
  private readonly logger = LoggerService.getInstance(
    BuilderSettingsService.name,
  );
  private readonly repository: Repository<BuilderSettings>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(BuilderSettings);
  }

  /**
   * The settings row, created disabled if it is somehow missing. Self-healing
   * rather than throwing: a missing row should make Builder unavailable, not
   * make every page that reads the switch 500.
   */
  async get(): Promise<BuilderSettings> {
    const existing = await this.repository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (existing) return existing;

    this.logger.warn('Builder settings row missing — creating it disabled.');
    return this.repository.save(this.repository.create({ enabled: false }));
  }

  async update(
    changes: Partial<
      Pick<
        BuilderSettings,
        | 'enabled'
        | 'maxConcurrentBuilds'
        | 'defaultBudgetUsd'
        | 'defaultEngine'
        | 'defaultModel'
      >
    >,
    userId: number,
  ): Promise<BuilderSettings> {
    const settings = await this.get();
    await this.repository.update(
      { id: settings.id },
      { ...changes, updatedBy: userId },
    );
    if (changes.enabled !== undefined) {
      // Worth a log line on its own: this is the switch that decides whether
      // an agent can write code, and "who turned it on" is the first question
      // anyone asks afterwards.
      this.logger.info(
        `Builder ${changes.enabled ? 'ENABLED' : 'DISABLED'} by user ${userId}`,
      );
    }
    return this.repository.findOneOrFail({ where: { id: settings.id } });
  }
}
