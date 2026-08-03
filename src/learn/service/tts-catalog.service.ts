import { BadRequestException, Injectable } from '@nestjs/common';
import * as textToSpeech from '@google-cloud/text-to-speech';
import { AppConfigService } from 'src/config/config.service';
import { TtsProvider } from '../enum/tts-provider.enum';
import { ElevenLabsVoiceSyncService } from './elevenlabs-voice-sync.service';

/** One selectable entry in a provider's model/voice catalog. */
export interface TtsCatalogEntry {
  /** What gets written into the voice's config field (e.g. `model`, `voice_name`). */
  value: string;
  /** What the picker shows. */
  label: string;
}

export interface TtsCatalogParams {
  provider: string;
  /**
   * The voice's own language (e.g. "en-IN") — Google (2,066 voices) and
   * Deepgram (102) both need this to be a usable picker rather than a wall
   * of mostly-irrelevant options. ElevenLabs and Hume don't take it: their
   * catalogs are small, or already scoped by `voiceProvider` below.
   */
  languageCode?: string;
  /**
   * Hume's own "voice_provider" field (HUME_AI | CUSTOM_VOICE) — its
   * `/v0/tts/voices` endpoint takes this as a real filter. Defaults to
   * HUME_AI when unset, matching the runtime default in ally-ai-learn's
   * HumeTTSClient ("Default to HUME_AI if not specified").
   */
  voiceProvider?: string;
}

const HUME_API = 'https://api.hume.ai/v0';
/** Defensive cap on Hume pagination — real usage is 1-2 pages; this just bounds a runaway loop. */
const HUME_MAX_PAGES = 50;

/**
 * Every TTS provider's model/voice catalog, behind one contract.
 *
 * Each provider's fetch is genuinely different — different auth (API key vs
 * OAuth2 via a service account), different base URL, different response
 * shape, different pagination — so that part stays provider-specific. What's
 * shared is the contract: give it a provider name (and whatever optional
 * scoping that provider's catalog needs), get back `{ value, label }[]`
 * ready for a picker.
 */
@Injectable()
export class TtsCatalogService {
  private googleClient: textToSpeech.TextToSpeechClient | undefined;

  constructor(
    private readonly configService: AppConfigService,
    private readonly elevenLabsVoiceSyncService: ElevenLabsVoiceSyncService,
  ) {}

  async getCatalog(params: TtsCatalogParams): Promise<TtsCatalogEntry[]> {
    switch (String(params.provider ?? '').toUpperCase()) {
      case TtsProvider.ELEVENLABS:
        return this.getElevenLabsCatalog();
      case TtsProvider.DEEPGRAM:
        return this.getDeepgramCatalog(params.languageCode);
      case TtsProvider.GOOGLE:
        return this.getGoogleCatalog(params.languageCode);
      case TtsProvider.HUME:
        return this.getHumeCatalog(params.voiceProvider);
      default:
        throw new BadRequestException(
          `No model catalog available for provider "${params.provider}".`,
        );
    }
  }

  private async getElevenLabsCatalog(): Promise<TtsCatalogEntry[]> {
    const models = await this.elevenLabsVoiceSyncService.listAvailableModels();
    return models.map((model) => ({ value: model.modelId, label: model.name }));
  }

  /**
   * `GET /v1/models` — free, a metadata call, not a synthesis call. Deepgram
   * doesn't tag with Indian regional variants (no "en-IN"; the closest is
   * generic "en" or "en-US"/"en-GB"/etc), so the language filter matches on
   * the code's PREFIX, not the exact value — an exact match would silently
   * return nothing for every Indian language.
   */
  private async getDeepgramCatalog(
    languageCode?: string,
  ): Promise<TtsCatalogEntry[]> {
    const apiKey = this.configService.voicePreview.deepgramApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'Deepgram is not configured on this environment.',
      );
    }

    const response = await fetch('https://api.deepgram.com/v1/models', {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!response.ok) {
      throw new BadRequestException(
        `Deepgram returned ${response.status} listing models.`,
      );
    }

    const body = (await response.json()) as {
      tts?: Array<{
        name?: string;
        canonical_name?: string;
        languages?: string[];
        metadata?: { display_name?: string };
      }>;
    };
    const all = (body.tts ?? []).filter((model) => model.canonical_name);
    const entries = this.filterByLanguagePrefix(
      all,
      languageCode,
      (model) => model.languages,
    );

    return entries.map((model) => {
      const name =
        model.metadata?.display_name || model.name || model.canonical_name!;
      return {
        value: model.canonical_name as string,
        label: `${name} (${model.canonical_name})`,
      };
    });
  }

  /**
   * Reuses the same `@google-cloud/text-to-speech` client (and ADC auth)
   * already used for voice previews — `listVoices` is a metadata call, free
   * like that. Instantiated lazily, not in the constructor: a bad credential
   * here must fail the one request that needs it, not the whole module's DI
   * graph (the same reasoning already applied to the preview provider).
   */
  private async getGoogleCatalog(
    languageCode?: string,
  ): Promise<TtsCatalogEntry[]> {
    if (!this.googleClient) {
      this.googleClient = new textToSpeech.TextToSpeechClient();
    }

    const [response] = await this.googleClient.listVoices({});
    const all = (response.voices ?? []).filter((voice) => voice.name);

    const matched = languageCode
      ? all.filter((voice) => voice.languageCodes?.includes(languageCode))
      : all;
    // 2,066 voices span every language Google supports — no match for this
    // voice's language should still leave something to pick from, not an
    // empty picker.
    const entries = matched.length ? matched : all;

    return entries.map((voice) => ({
      value: voice.name as string,
      label: `${voice.name} (${(voice.ssmlGender ?? 'unspecified').toString().toLowerCase()})`,
    }));
  }

  /**
   * `GET /v0/tts/voices` — paginated, free. Defaults to HUME_AI (the built-in
   * library) when no voice_provider is set yet, matching the runtime default.
   *
   * Needs a real browser-shaped User-Agent to get past Cloudflare's WAF — a
   * bare Python client with no UA was 403'd (verified); Node's default
   * `fetch` sends a real one via undici and passes through fine, so nothing
   * extra is needed here.
   */
  private async getHumeCatalog(
    voiceProvider?: string,
  ): Promise<TtsCatalogEntry[]> {
    const apiKey = this.configService.voicePreview.humeApiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'Hume is not configured on this environment.',
      );
    }

    const provider = voiceProvider || 'HUME_AI';
    const entries: TtsCatalogEntry[] = [];

    for (let page = 0; page < HUME_MAX_PAGES; page += 1) {
      const response = await fetch(
        `${HUME_API}/tts/voices?provider=${provider}&page_size=100&page_number=${page}`,
        { headers: { 'X-Hume-Api-Key': apiKey } },
      );
      if (!response.ok) {
        throw new BadRequestException(
          `Hume returned ${response.status} listing voices.`,
        );
      }

      const body = (await response.json()) as {
        voices_page?: Array<{ name?: string; tags?: Record<string, string[]> }>;
        total_pages?: number;
      };
      for (const voice of body.voices_page ?? []) {
        if (!voice.name) continue;
        const gender = voice.tags?.GENDER?.[0];
        entries.push({
          value: voice.name,
          label: gender ? `${voice.name} (${gender})` : voice.name,
        });
      }

      if (page >= (body.total_pages ?? 1) - 1) break;
    }

    return entries;
  }

  /** Shared by Deepgram (prefix match) — Google matches exactly instead, since its codes already include the regional suffix. */
  private filterByLanguagePrefix<T>(
    all: T[],
    languageCode: string | undefined,
    getLanguages: (item: T) => string[] | undefined,
  ): T[] {
    const prefix = languageCode?.split('-')[0]?.toLowerCase();
    if (!prefix) return all;

    const matched = all.filter((item) =>
      (getLanguages(item) ?? []).some((l) =>
        l.toLowerCase().startsWith(prefix),
      ),
    );
    return matched.length ? matched : all;
  }
}
