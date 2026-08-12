import { Injectable } from '@nestjs/common';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import {
  DEFAULT_WHATSAPP_SETTINGS,
  WHATSAPP_SETTINGS_NAME,
  WhatsAppBotSettings,
} from '../type/whatsapp-settings.type';

@Injectable()
export class WhatsAppSettingsService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppSettingsService.name,
  );

  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /**
   * Read the settings, filling any missing field from defaults.
   *
   * Merged per field, including the nested `rateLimit` and `retrieval` objects, rather than
   * "stored row OR defaults". A row written before a field existed would otherwise leave it
   * undefined, and an undefined threshold does not fall back — it disables the gate that depends
   * on it. A missing `declineSimilarity`, for instance, would silently stop the bot ever declining.
   */
  async get(): Promise<WhatsAppBotSettings> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name: WHATSAPP_SETTINGS_NAME },
    });
    return this.merge(row?.value as Partial<WhatsAppBotSettings> | undefined);
  }

  private merge(
    stored: Partial<WhatsAppBotSettings> | undefined,
  ): WhatsAppBotSettings {
    return {
      ...DEFAULT_WHATSAPP_SETTINGS,
      ...(stored ?? {}),
      rateLimit: {
        ...DEFAULT_WHATSAPP_SETTINGS.rateLimit,
        ...(stored?.rateLimit ?? {}),
      },
      retrieval: {
        ...DEFAULT_WHATSAPP_SETTINGS.retrieval,
        ...(stored?.retrieval ?? {}),
      },
    };
  }

  /** Update settings, merging over what is stored so a partial save cannot blank a field. */
  async update(
    patch: Partial<WhatsAppBotSettings>,
  ): Promise<WhatsAppBotSettings> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: WHATSAPP_SETTINGS_NAME },
    });

    const merged = this.merge({
      ...((existing?.value as Partial<WhatsAppBotSettings>) ?? {}),
      ...patch,
      rateLimit: {
        ...((existing?.value as WhatsAppBotSettings)?.rateLimit ?? {}),
        ...(patch.rateLimit ?? {}),
      },
      retrieval: {
        ...((existing?.value as WhatsAppBotSettings)?.retrieval ?? {}),
        ...(patch.retrieval ?? {}),
      },
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
          name: WHATSAPP_SETTINGS_NAME,
          value: merged,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }

    this.logger.info('WhatsApp bot settings updated');
    return merged;
  }

  /** Substitute the placeholders a template body may contain. */
  renderPlaceholders(text: string, settings: WhatsAppBotSettings): string {
    return text.replace(
      /\{helpline_numbers\}/g,
      settings.helplineNumbers || 'your local crisis line',
    );
  }
}
