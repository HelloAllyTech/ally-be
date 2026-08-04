import { BadRequestException, Injectable } from '@nestjs/common';
import * as textToSpeech from '@google-cloud/text-to-speech';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { Gender } from '../enum/gender.enum';
import { TtsProvider } from '../enum/tts-provider.enum';
import { toScenarioVoiceGender } from '../util/voice-gender.util';
import { ElevenLabsVoiceSyncService } from './elevenlabs-voice-sync.service';

/** One selectable entry in a provider's model/voice catalog. */
export interface TtsCatalogEntry {
  /** What gets written into the voice's config field (e.g. `model`, `voice_name`). */
  value: string;
  /** What the picker shows. */
  label: string;
  /**
   * This voice's gender, where the provider publishes one, so a client can
   * narrow the picker to the gender being configured. Absent — not guessed —
   * whenever the provider says nothing usable: Deepgram exposes no gender at
   * all (its metadata is accent/age/color/display_name/image/sample/tags/
   * use_cases), ElevenLabs' catalog is models rather than voices, and Google
   * reports NEUTRAL for some voices, which is not one of ours. A consumer must
   * therefore treat `undefined` as "unknown", not as "no match", or those
   * pickers go empty.
   */
  gender?: Gender;
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

/**
 * A Google voice name that names its own language, e.g. `en-IN-Standard-A` or
 * `ar-XA-Chirp3-HD-Achernar`. Case-insensitive because two real voices
 * (`fil-ph-Neural2-A`, `fil-ph-Neural2-D`) lowercase their region.
 */
const LANGUAGE_PREFIXED_VOICE = /^[a-z]{2,3}-[a-z]{2}/i;

const HUME_API = 'https://api.hume.ai/v0';
/** Defensive cap on Hume pagination — real usage is 1-2 pages; this just bounds a runaway loop. */
const HUME_MAX_PAGES = 50;

/**
 * How long a fetched catalog is served before we ask the provider again.
 *
 * These lists move on a provider's release cadence — weeks or months — so the
 * window could be far longer. It is deliberately short because Hume's catalog
 * includes CUSTOM_VOICE, which an admin creates themselves and would expect to
 * see; 15 minutes bounds how long a voice they just made stays invisible while
 * still collapsing a session's worth of panel opens into one fetch.
 */
const CATALOG_TTL_MS = 15 * 60 * 1000;

interface CachedCatalog {
  entries: TtsCatalogEntry[];
  fetchedAt: number;
}

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
  private readonly logger = LoggerService.getInstance(TtsCatalogService.name);
  private googleClient: textToSpeech.TextToSpeechClient | undefined;
  /**
   * Last good catalog per provider+scope. In-process rather than Redis on
   * purpose: a few KB of read-only reference data, on an admin-only endpoint,
   * where a per-instance copy costs one warm-up fetch and saves a network hop
   * plus serialisation on every hit.
   */
  private readonly cache = new Map<string, CachedCatalog>();

  constructor(
    private readonly configService: AppConfigService,
    private readonly elevenLabsVoiceSyncService: ElevenLabsVoiceSyncService,
  ) {}

  /**
   * Cached, and — the point of the cache — falls back to the last good answer
   * when the provider call fails.
   *
   * A plain TTL would not have helped the case this was written for: an expired
   * Google credential made every call 500, the studio's Voice name field
   * silently degraded from a picker to a free-text box, and it read as a broken
   * dropdown rather than a credential problem. Serving a stale list keeps the
   * picker working through an outage or a credential lapse, which is strictly
   * better than showing nothing — these lists barely move, so a stale one is
   * very likely still correct.
   *
   * Stale entries are kept indefinitely rather than expiring, precisely so the
   * fallback is still there during a long outage. A failure with nothing cached
   * still throws — there is nothing honest to show.
   */
  async getCatalog(params: TtsCatalogParams): Promise<TtsCatalogEntry[]> {
    const provider = String(params.provider ?? '').toUpperCase();
    const key = [
      provider,
      params.languageCode ?? '',
      params.voiceProvider ?? '',
    ].join('|');

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
      return cached.entries;
    }

    try {
      const entries = await this.fetchCatalog(provider, params);
      this.cache.set(key, { entries, fetchedAt: Date.now() });
      return entries;
    } catch (error) {
      if (!cached) throw error;
      const ageMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
      this.logger.warn(
        `[TTS_CATALOG] ${provider} refresh failed; serving a catalog cached ${ageMinutes}m ago (${cached.entries.length} entries). ` +
          `Reason: ${error instanceof Error ? error.message : String(error)}`,
      );
      return cached.entries;
    }
  }

  private async fetchCatalog(
    provider: string,
    params: TtsCatalogParams,
  ): Promise<TtsCatalogEntry[]> {
    switch (provider) {
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

    // Gemini's voices report `languageCodes: ["en-US"]` and nothing else, so
    // the language filter above drops all 30 of them for every voice that
    // isn't en-US — which is nearly all of ours. They are not really en-US
    // only: the model synthesises many languages, the listing just has no way
    // to say so (a returned Voice carries only languageCodes/name/ssmlGender/
    // naturalSampleRateHertz — no model field, and the word "gemini" appears
    // nowhere in the response). So add them back for every language.
    //
    // Identified by name shape rather than a hardcoded list, so a voice Google
    // adds later appears on its own: Gemini names are bare ("Kore",
    // "Achernar") while every other voice is "{lang}-{REGION}-...". The test
    // is case-insensitive on purpose — `fil-ph-Neural2-A` and
    // `fil-ph-Neural2-D` lowercase their region, and are the only two
    // non-Gemini names that would otherwise slip through.
    const seen = new Set(entries.map((voice) => voice.name));
    const languageAgnostic = all.filter(
      (voice) =>
        !seen.has(voice.name) && !LANGUAGE_PREFIXED_VOICE.test(voice.name!),
    );

    const label = (voice: (typeof all)[number], suffix = '') =>
      `${voice.name} (${(voice.ssmlGender ?? 'unspecified').toString().toLowerCase()}${suffix})`;
    // NEUTRAL is a real ssmlGender and is not one of ours, so it maps to
    // undefined ("unknown") rather than being forced into non-binary.
    const gender = (voice: (typeof all)[number]) =>
      toScenarioVoiceGender(voice.ssmlGender?.toString()) ?? undefined;

    return [
      ...entries.map((voice) => ({
        value: voice.name as string,
        label: label(voice),
        gender: gender(voice),
      })),
      // Flagged, and last: for a Tamil or Marathi voice these are a deliberate
      // choice, not one of the language's own voices.
      ...languageAgnostic.map((voice) => ({
        value: voice.name as string,
        label: label(voice, ' · Gemini, any language'),
        gender: gender(voice),
      })),
    ];
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
        // Hume title-cases its tag ("Female"), so keep the raw string for the
        // label and normalise separately for the filterable field.
        const gender = voice.tags?.GENDER?.[0];
        entries.push({
          value: voice.name,
          label: gender ? `${voice.name} (${gender})` : voice.name,
          gender: toScenarioVoiceGender(gender) ?? undefined,
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
