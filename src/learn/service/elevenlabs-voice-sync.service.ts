import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  buildElevenLabsModelOptions,
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
  /** Models to offer for this voice, derived from ElevenLabs' own answer plus v3. */
  availableModels: string[];
  /** A safe starting model, or null when there's nothing to prefer. */
  recommendedModel: string | null;
}

/**
 * Outcome of looking up a voice id that has no scenario_voices row yet.
 *
 * Same facts as {@link ElevenLabsVoiceSyncResult} minus `warning` (the caller
 * doesn't have a chosen model yet to warn against) and `persisted` (there is
 * no row to write to) — plus `gender` and `language`, which a not-yet-saved
 * voice benefits from autofilling.
 */
export interface ElevenLabsVoiceLookupResult {
  /** The id that was looked up. */
  voiceId: string;
  resolvedVoiceId: string | null;
  voiceIdMismatch: boolean;
  category: string | null;
  resolvedName: string | null;
  voiceType: ElevenLabsVoiceType | null;
  /** From ElevenLabs' `labels.gender`, present on 132 of 153 voices on this account. */
  gender: string | null;
  /** From ElevenLabs' `labels.language`, present on all voices on this account. */
  language: string | null;
  /** Models to offer for this voice, derived from ElevenLabs' own answer plus v3. */
  availableModels: string[];
  /** A safe starting model, or null when there's nothing to prefer. */
  recommendedModel: string | null;
}

/**
 * Outcome of syncing every ElevenLabs scenario_voices row in one pass.
 *
 * `mismatched` and `failed` are the two ways a stored id can be wrong: it
 * resolves to some other voice, or it doesn't resolve at all. Everything else
 * — the common case — is just a `voice_type` write, counted in `updated`.
 */
export interface ElevenLabsBulkSyncSummary {
  /** ElevenLabs rows examined (rows with no voice_id are skipped, not counted). */
  checked: number;
  /** Rows whose voice_type changed. */
  updated: number;
  mismatched: Array<{
    voiceId: string;
    name: string;
    storedVoiceId: string;
    resolvedVoiceId: string;
    resolvedName: string;
  }>;
  failed: Array<{
    voiceId: string;
    name: string;
    storedVoiceId: string;
    error: string;
  }>;
}

/** A model from ElevenLabs' account-wide catalog — not tied to any one voice. */
export interface ElevenLabsModelInfo {
  modelId: string;
  name: string;
}

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_API_V2 = 'https://api.elevenlabs.io/v2';

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
    const { availableModels, recommendedModel } = buildElevenLabsModelOptions(
      remote?.high_quality_base_model_ids,
      voiceType,
    );

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
      availableModels,
      recommendedModel,
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

  /**
   * Look up a voice id before it has a scenario_voices row — for a new voice,
   * as it's being typed in, rather than after saving. Nothing is persisted;
   * there is nothing to persist to yet.
   */
  async lookupVoice(voiceId: string): Promise<ElevenLabsVoiceLookupResult> {
    const trimmed = String(voiceId ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('voiceId is required.');
    }

    const apiKey = this.configService.voicePreview.elevenlabsApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'ElevenLabs is not configured on this environment.',
      );
    }

    const remote = await this.fetchVoice(trimmed, apiKey);
    const category = remote?.category ?? null;
    const resolvedVoiceId = remote?.voice_id ?? null;
    const voiceType = category
      ? (ELEVENLABS_CATEGORY_TO_VOICE_TYPE[category.toLowerCase()] ??
        ElevenLabsVoiceType.UNKNOWN)
      : null;
    const { availableModels, recommendedModel } = buildElevenLabsModelOptions(
      remote?.high_quality_base_model_ids,
      voiceType,
    );

    return {
      voiceId: trimmed,
      resolvedVoiceId,
      voiceIdMismatch: Boolean(resolvedVoiceId && resolvedVoiceId !== trimmed),
      category,
      resolvedName: remote?.name ?? null,
      voiceType,
      gender: remote?.labels?.gender ?? null,
      language: remote?.labels?.language ?? null,
      availableModels,
      recommendedModel,
    };
  }

  /**
   * Sync every ElevenLabs scenario_voices row's voice_type in one pass.
   *
   * Fast path: `GET /v2/voices` lists the whole workspace — category included
   * — in a couple of paginated calls, regardless of how many rows there are.
   * Matching a stored id against that listing needs no per-voice request.
   *
   * Slow path: a stored id that isn't in the listing at all (7 of 77 in
   * production — well-known public-library ids, not workspace voices) falls
   * back to the single-voice sync, which is what can tell "resolves to a
   * different voice" apart from "not a voice at all".
   */
  async bulkSyncAllVoices(): Promise<ElevenLabsBulkSyncSummary> {
    const apiKey = this.configService.voicePreview.elevenlabsApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'ElevenLabs is not configured on this environment.',
      );
    }

    const listing = await this.fetchAllVoiceCategories(apiKey);
    const rows = await this.scenarioVoicesRepository.find({
      where: { provider: TtsProvider.ELEVENLABS },
    });

    const summary: ElevenLabsBulkSyncSummary = {
      checked: 0,
      updated: 0,
      mismatched: [],
      failed: [],
    };

    for (const row of rows) {
      const config = (row.config ?? {}) as Record<string, any>;
      const storedVoiceId = String(
        config.voice_id ?? config.voiceId ?? '',
      ).trim();
      if (!storedVoiceId) continue;
      summary.checked += 1;

      const listed = listing.get(storedVoiceId);
      if (listed) {
        const voiceType = listed.category
          ? (ELEVENLABS_CATEGORY_TO_VOICE_TYPE[listed.category.toLowerCase()] ??
            ElevenLabsVoiceType.UNKNOWN)
          : null;
        if (voiceType && config.voice_type !== voiceType) {
          await this.scenarioVoicesRepository.update(row.id, {
            config: { ...config, voice_type: voiceType } as Record<string, any>,
          });
          summary.updated += 1;
        }
        continue;
      }

      try {
        const result = await this.syncVoice(row.id);
        if (result.persisted) summary.updated += 1;
        if (result.voiceIdMismatch) {
          summary.mismatched.push({
            voiceId: row.id,
            name: row.name,
            storedVoiceId: result.storedVoiceId,
            resolvedVoiceId: result.resolvedVoiceId ?? '',
            resolvedName: result.resolvedName ?? '',
          });
        }
      } catch (error) {
        summary.failed.push({
          voiceId: row.id,
          name: row.name,
          storedVoiceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (summary.mismatched.length || summary.failed.length) {
      this.logger.warn(
        `[ELEVENLABS_SYNC] bulk: checked=${summary.checked} updated=${summary.updated} ` +
          `mismatched=${summary.mismatched.length} failed=${summary.failed.length}`,
      );
    }

    return summary;
  }

  /**
   * The account-wide model catalog — independent of any one voice. This is
   * what a Model picker's options come from; a voice's own
   * `high_quality_base_model_ids` (used elsewhere for `recommendedModel`) is
   * a narrower, per-voice fine-tune-compatibility signal, not the option list.
   *
   * Filtered to `can_do_text_to_speech`: ElevenLabs' /v1/models also lists
   * speech-to-speech-only models (voice conversion), which this account can't
   * use to generate scenario audio from text.
   */
  async listAvailableModels(): Promise<ElevenLabsModelInfo[]> {
    const apiKey = this.configService.voicePreview.elevenlabsApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'ElevenLabs is not configured on this environment.',
      );
    }

    const response = await fetch(`${ELEVENLABS_API}/models`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) {
      throw new BadRequestException(
        `ElevenLabs returned ${response.status} listing models.`,
      );
    }

    const body = (await response.json()) as Array<{
      model_id?: string;
      name?: string;
      can_do_text_to_speech?: boolean;
    }>;

    return body
      .filter((model) => model.can_do_text_to_speech && model.model_id)
      .map((model) => ({
        modelId: model.model_id as string,
        name: model.name ?? (model.model_id as string),
      }));
  }

  /** Pages through the whole workspace once, keyed by voice_id. Free — this is a listing call, not a generation call. */
  private async fetchAllVoiceCategories(
    apiKey: string,
  ): Promise<Map<string, { category: string; name: string }>> {
    const map = new Map<string, { category: string; name: string }>();
    let pageToken: string | undefined;

    do {
      const url = new URL(`${ELEVENLABS_API_V2}/voices`);
      url.searchParams.set('page_size', '100');
      if (pageToken) url.searchParams.set('next_page_token', pageToken);

      const response = await fetch(url.toString(), {
        headers: { 'xi-api-key': apiKey },
      });
      if (!response.ok) {
        throw new BadRequestException(
          `ElevenLabs returned ${response.status} listing voices.`,
        );
      }

      const body = (await response.json()) as {
        voices?: Array<{ voice_id?: string; category?: string; name?: string }>;
        has_more?: boolean;
        next_page_token?: string;
      };
      for (const voice of body.voices ?? []) {
        if (voice.voice_id) {
          map.set(voice.voice_id, {
            category: voice.category ?? '',
            name: voice.name ?? '',
          });
        }
      }
      pageToken = body.has_more ? body.next_page_token : undefined;
    } while (pageToken);

    return map;
  }

  private async fetchVoice(
    voiceId: string,
    apiKey: string,
  ): Promise<{
    voice_id?: string;
    category?: string;
    name?: string;
    labels?: Record<string, string>;
    high_quality_base_model_ids?: string[];
  } | null> {
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
