import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  ELEVENLABS_CATEGORY_TO_VOICE_TYPE,
  ElevenLabsVoiceType,
  getElevenLabsV3Warning,
} from '../constants/elevenlabs-voice-type.constants';
import { TtsProvider } from '../enum/tts-provider.enum';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';

export interface ElevenLabsVoiceSyncResult {
  /** The id stored on the row. */
  storedVoiceId: string;
  /** The id ElevenLabs actually returned for it. */
  resolvedVoiceId: string | null;
  /**
   * True when ElevenLabs resolved the stored id to a DIFFERENT voice.
   *
   * Observed on 7 of 77 production ids, all of them well-known public-library
   * ids: requesting them returns 200 with another workspace voice. A bogus id
   * correctly 400s, so this is resolution, not a catch-all fallback. It means a
   * stored id does not necessarily name the voice that renders.
   */
  voiceIdMismatch: boolean;
  /** ElevenLabs' own category for the resolved voice. */
  category: string | null;
  /** Name of the resolved voice, so a mismatch is legible. */
  resolvedName: string | null;
  /** What we derived from `category`. */
  voiceType: ElevenLabsVoiceType | null;
  /** Non-blocking v3 advisory, or null. */
  warning: string | null;
  /** Whether the row was updated. */
  persisted: boolean;
}

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

/**
 * Pulls a voice's creation type from ElevenLabs so v3 compatibility stops being
 * invisible.
 *
 * Necessary because nothing local can answer it: the model string and the voice
 * id both look identical whether the voice is a Professional clone (which v3
 * cannot render from) or an Instant clone (which it can). And a v3 call against
 * a PVC returns 200 with plausible audio, so no amount of testing or logging
 * surfaces it.
 */
@Injectable()
export class ElevenLabsVoiceSyncService {
  private readonly logger = LoggerService.getInstance(
    ElevenLabsVoiceSyncService.name,
  );

  constructor(
    private readonly scenarioVoicesRepository: ScenarioVoicesRepository,
    private readonly configService: AppConfigService,
  ) {}

  async syncVoice(
    id: string,
    persist = true,
  ): Promise<ElevenLabsVoiceSyncResult> {
    const voice = await this.scenarioVoicesRepository.findOne({
      where: { id },
    });
    if (!voice) throw new NotFoundException('Scenario voice not found');

    if (String(voice.provider).toUpperCase() !== TtsProvider.ELEVENLABS) {
      throw new BadRequestException(
        `Only ElevenLabs voices can be synced; this one is ${voice.provider}.`,
      );
    }

    const config = (voice.config ?? {}) as Record<string, any>;
    // Production stores the legacy `voiceId` spelling on every row; the schema's
    // canonical key is `voice_id`. Read both.
    const storedVoiceId = String(
      config.voice_id ?? config.voiceId ?? '',
    ).trim();
    if (!storedVoiceId) {
      throw new BadRequestException('This voice has no voice_id to look up.');
    }

    const apiKey = this.configService.voicePreview.elevenlabsApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'ElevenLabs is not configured on this environment.',
      );
    }

    const remote = await this.fetchVoice(storedVoiceId, apiKey);
    const category = remote?.category ?? null;
    const resolvedVoiceId = remote?.voice_id ?? null;
    const voiceType = category
      ? (ELEVENLABS_CATEGORY_TO_VOICE_TYPE[category.toLowerCase()] ??
        ElevenLabsVoiceType.UNKNOWN)
      : null;

    const result: ElevenLabsVoiceSyncResult = {
      storedVoiceId,
      resolvedVoiceId,
      voiceIdMismatch: Boolean(
        resolvedVoiceId && resolvedVoiceId !== storedVoiceId,
      ),
      category,
      resolvedName: remote?.name ?? null,
      voiceType,
      warning: getElevenLabsV3Warning(config.model, voiceType),
      persisted: false,
    };

    if (persist && voiceType) {
      // Write only the derived type. The stored voice_id is deliberately left
      // alone even on a mismatch: repointing it changes which voice renders,
      // which is a content decision, not a sync.
      await this.scenarioVoicesRepository.update(id, {
        config: { ...config, voice_type: voiceType } as Record<string, any>,
      });
      result.persisted = true;
    }

    if (result.voiceIdMismatch) {
      this.logger.warn(
        `[ELEVENLABS_SYNC] voice ${id}: stored ${storedVoiceId} resolves to ${resolvedVoiceId} (${result.resolvedName}, ${category})`,
      );
    }

    return result;
  }

  private async fetchVoice(
    voiceId: string,
    apiKey: string,
  ): Promise<{ voice_id?: string; category?: string; name?: string } | null> {
    try {
      const response = await fetch(`${ELEVENLABS_API}/voices/${voiceId}`, {
        headers: { 'xi-api-key': apiKey },
      });
      if (!response.ok) {
        // A bogus id 400s here, which is the useful case: it means the stored id
        // is not a voice at all, rather than one that resolves elsewhere.
        throw new BadRequestException(
          `ElevenLabs returned ${response.status} for voice_id "${voiceId}".`,
        );
      }
      return (await response.json()) as Record<string, any>;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `Could not reach ElevenLabs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
