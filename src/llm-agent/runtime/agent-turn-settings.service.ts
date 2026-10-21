import { Injectable } from '@nestjs/common';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { LoggerService } from 'src/logger/logger.service';

/** The `global_settings` row holding the switches. */
export const VALIDATED_AGENT_TURNS_SETTING = 'validated_agent_turns';

/**
 * The validated-turns kill switch, per agent: on, a turn ends only through a
 * checked reply (`runValidatedTurn`); off, the agent's previous loop runs
 * unchanged. Builder has its own, `builder_settings.validatedTurns`, beside
 * its other settings.
 */
export interface ValidatedAgentTurnsSettings {
  courseCopilot: boolean;
  characterInterview: boolean;
}

export type ValidatedTurnAgentKey = keyof ValidatedAgentTurnsSettings;

/**
 * On unless someone turned it off — the same default as Builder's switch. A
 * missing row is every environment before the first save.
 */
export const DEFAULT_VALIDATED_AGENT_TURNS: ValidatedAgentTurnsSettings = {
  courseCopilot: true,
  characterInterview: true,
};

@Injectable()
export class AgentTurnSettingsService {
  private readonly logger = LoggerService.getInstance(
    AgentTurnSettingsService.name,
  );

  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /** The switches, each missing one filled from the defaults. */
  async get(): Promise<ValidatedAgentTurnsSettings> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name: VALIDATED_AGENT_TURNS_SETTING },
    });
    return this.merge(row?.value);
  }

  /**
   * Whether this agent's next turn runs validated. Read per turn, so a switch
   * takes effect on the next message. A read that fails keeps validated turns
   * on: the default, and the loop whose replies are checked.
   */
  async enabled(agent: ValidatedTurnAgentKey): Promise<boolean> {
    try {
      return (await this.get())[agent];
    } catch (error) {
      this.logger.warn(
        `Validated-turn settings unavailable; running ${agent} validated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /** Merge a partial change over what is stored, so one switch never blanks the other. */
  async update(
    patch: Partial<ValidatedAgentTurnsSettings>,
    userId: number,
  ): Promise<ValidatedAgentTurnsSettings> {
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: VALIDATED_AGENT_TURNS_SETTING },
    });
    const merged = this.merge({
      ...(existing?.value ?? {}),
      ...Object.fromEntries(
        Object.entries(patch).filter(
          ([key, value]) =>
            key in DEFAULT_VALIDATED_AGENT_TURNS && typeof value === 'boolean',
        ),
      ),
    });
    if (existing) {
      await this.globalSettingsRepository.update(
        { id: existing.id },
        { value: merged as unknown as Record<string, any>, updatedBy: userId },
      );
    } else {
      await this.globalSettingsRepository.save(
        this.globalSettingsRepository.create({
          name: VALIDATED_AGENT_TURNS_SETTING,
          value: merged as unknown as Record<string, any>,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }
    this.logger.info(
      `Validated agent turns: course copilot ${merged.courseCopilot ? 'on' : 'off'}, ` +
        `character interview ${merged.characterInterview ? 'on' : 'off'} (user ${userId})`,
    );
    return merged;
  }

  private merge(
    stored: Record<string, any> | null | undefined,
  ): ValidatedAgentTurnsSettings {
    const value = stored ?? {};
    return {
      courseCopilot:
        typeof value.courseCopilot === 'boolean'
          ? value.courseCopilot
          : DEFAULT_VALIDATED_AGENT_TURNS.courseCopilot,
      characterInterview:
        typeof value.characterInterview === 'boolean'
          ? value.characterInterview
          : DEFAULT_VALIDATED_AGENT_TURNS.characterInterview,
    };
  }
}
