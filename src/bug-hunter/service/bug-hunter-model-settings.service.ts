import { Injectable } from '@nestjs/common';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import {
  BUG_HUNTER_MODEL_SETTINGS_NAME,
  BugHunterModelSettings,
  DEFAULT_BUG_HUNTER_MODEL_SETTINGS,
} from '../type/bug-hunter-model-settings.type';

/**
 * Which models the sweep/fix-session pipeline and its escalation subagent run on — the
 * settings-driven replacement for the hardcoded `--model` flag in `bug-hunt-sweep.yml` /
 * `bug-fix-session.yml` and the static `model:` frontmatter in `.claude/agents/bug-escalation.md`.
 * Same `GlobalSettings`-backed get/merge/update shape as `WhatsAppSettingsService`.
 */
@Injectable()
export class BugHunterModelSettingsService {
  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /** Read the settings, filling any missing field from defaults. */
  async get(): Promise<BugHunterModelSettings> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name: BUG_HUNTER_MODEL_SETTINGS_NAME },
    });
    return this.merge(
      row?.value as Partial<BugHunterModelSettings> | undefined,
    );
  }

  private merge(
    stored: Partial<BugHunterModelSettings> | undefined,
  ): BugHunterModelSettings {
    return { ...DEFAULT_BUG_HUNTER_MODEL_SETTINGS, ...(stored ?? {}) };
  }

  /** Update settings, merging over what is stored so a partial save cannot blank a field. */
  async update(
    patch: Partial<BugHunterModelSettings>,
    userId: number,
  ): Promise<BugHunterModelSettings> {
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: BUG_HUNTER_MODEL_SETTINGS_NAME },
    });

    const merged = this.merge({
      ...((existing?.value as Partial<BugHunterModelSettings>) ?? {}),
      ...patch,
    });

    if (existing) {
      await this.globalSettingsRepository.update(
        { id: existing.id },
        // Cast: GlobalSettings.value is a loose Record<string, any> jsonb column, and TypeORM's
        // deep-partial type wants an index signature that a precise interface does not have.
        { value: merged as unknown as Record<string, any>, updatedBy: userId },
      );
    } else {
      await this.globalSettingsRepository.save(
        this.globalSettingsRepository.create({
          name: BUG_HUNTER_MODEL_SETTINGS_NAME,
          value: merged,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }

    return merged;
  }
}
