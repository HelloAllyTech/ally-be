import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ProviderConfigRepository } from '../repository/provider-config.repository';
import {
  ProviderConfigSchema,
  validateProviderConfig,
} from '../util/provider-config-schema.util';

export interface ProviderConfigRow {
  id: string;
  name: string;
  provider: string;
  config: Record<string, any>;
  active: boolean;
}

export interface ProviderConfigInput {
  name?: string;
  provider?: string;
  config?: Record<string, any>;
  active?: boolean;
}

/**
 * CRUD shared by the provider-config registries (STT, LLM).
 *
 * The two concrete services were identical apart from the table they wrote to
 * and the `languages` column that pins them, so everything except those two
 * facts lives here. Subclasses supply the repository, the field schema, a
 * human label for messages, and how to find the languages still depending on a
 * row.
 */
export abstract class ProviderConfigService<T extends ProviderConfigRow> {
  protected abstract readonly repository: ProviderConfigRepository<any>;
  protected abstract readonly schema: ProviderConfigSchema;
  /** Used in error messages, e.g. "STT config" / "LLM config". */
  protected abstract readonly label: string;
  protected readonly logger = LoggerService.getInstance(
    ProviderConfigService.name,
  );

  /** Labels of the languages that still default to this config. */
  protected abstract findDependentLanguageLabels(id: string): Promise<string[]>;

  async getConfigs(activeOnly = false): Promise<T[]> {
    return this.repository.listConfigs(activeOnly) as Promise<T[]>;
  }

  /**
   * Single row by id, or null.
   *
   * Exists so callers outside this module (e.g. the LLM preview) can resolve a
   * config without LearnModule having to export a repository — the module
   * exports services only.
   */
  async getConfigById(id: string): Promise<T | null> {
    return this.repository.findOne({ where: { id } }) as Promise<T | null>;
  }

  async createConfig(dto: ProviderConfigInput): Promise<T> {
    const name = this.assertName(dto.name);
    await this.assertNameIsFree(name);
    this.assertConfigIsValid(dto.provider, dto.config);

    const created = this.repository.create({
      name,
      provider: dto.provider,
      config: { ...(dto.config ?? {}) },
      active: dto.active ?? true,
    });

    return this.repository.save(created) as Promise<T>;
  }

  async updateConfig(id: string, dto: ProviderConfigInput): Promise<T> {
    const existing = (await this.repository.findOne({
      where: { id } as any,
    })) as T | null;
    if (!existing) {
      throw new NotFoundException(`${this.label} not found`);
    }

    if (dto.name !== undefined) {
      const name = this.assertName(dto.name);
      if (name !== existing.name) {
        await this.assertNameIsFree(name);
        existing.name = name;
      }
    }
    if (dto.provider !== undefined) existing.provider = dto.provider;
    if (dto.config !== undefined) existing.config = { ...dto.config };
    if (dto.active !== undefined) existing.active = dto.active;

    // Re-validate the *merged* row. A partial update can omit `provider` while
    // changing `config` (or the reverse), so neither half is checkable alone.
    this.assertConfigIsValid(existing.provider, existing.config);

    return this.repository.save(existing) as Promise<T>;
  }

  /**
   * Deleting a config a language still points at would silently drop that
   * language to the platform default mid-flight, so refuse and name the
   * languages instead. Deactivating is the way to retire one.
   */
  async deleteConfig(id: string): Promise<{ deleted: true }> {
    const existing = await this.repository.findOne({ where: { id } as any });
    if (!existing) {
      throw new NotFoundException(`${this.label} not found`);
    }

    const inUseBy = await this.findDependentLanguageLabels(id);
    if (inUseBy.length > 0) {
      throw new ConflictException(
        `Still the default for ${inUseBy.join(', ')}. Point those languages ` +
          `elsewhere, or deactivate this config instead.`,
      );
    }

    await this.repository.delete(id);
    this.logger.info(`[PROVIDER_REGISTRY] deleted ${this.label} ${id}`);
    return { deleted: true };
  }

  private assertConfigIsValid(
    provider: string | undefined,
    config: Record<string, any> | undefined,
  ): void {
    const errors = validateProviderConfig(this.schema, provider, config, {
      subject: this.label,
    });
    if (errors.length) {
      throw new BadRequestException(errors.join(' '));
    }
  }

  private assertName(name: string | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException(`${this.label} name cannot be empty`);
    }
    return trimmed;
  }

  private async assertNameIsFree(name: string): Promise<void> {
    const clash = await this.repository.findOne({ where: { name } as any });
    if (clash) {
      throw new ConflictException(
        `${this.label} named "${name}" already exists`,
      );
    }
  }
}
