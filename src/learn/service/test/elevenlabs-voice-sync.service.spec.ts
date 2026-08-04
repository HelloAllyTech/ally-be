import { BadRequestException } from '@nestjs/common';
import { ElevenLabsVoiceSyncService } from '../elevenlabs-voice-sync.service';
import { TtsProvider } from '../../enum/tts-provider.enum';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe('ElevenLabsVoiceSyncService', () => {
  let service: ElevenLabsVoiceSyncService;
  let repository: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let configService: { voicePreview: { elevenlabsApiKey: string | undefined } };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    repository = { findOne: jest.fn(), find: jest.fn(), update: jest.fn() };
    configService = { voicePreview: { elevenlabsApiKey: 'test-key' } };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    service = new ElevenLabsVoiceSyncService(
      repository as any,
      configService as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * lookupVoice/syncVoice now fetch the voice AND the account-wide catalog
   * in parallel (Promise.all) — a bare `mockResolvedValue` can't tell those
   * two calls apart, so tests that need both dispatch by URL instead.
   */
  const mockFetchByUrl = (voiceResponse: any, modelsCatalog: any[] = []) => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/models')
          ? { ok: true, json: async () => modelsCatalog }
          : { ok: true, json: async () => voiceResponse },
      ),
    );
  };

  describe('lookupVoice', () => {
    it('resolves a voice with no scenario_voices row, without touching the DB', async () => {
      mockFetchByUrl({
        voice_id: 'abc',
        category: 'generated',
        name: 'Meenakshi',
        labels: { gender: 'female', language: 'ta' },
      });

      const result = await service.lookupVoice('abc');

      expect(result).toEqual({
        voiceId: 'abc',
        resolvedVoiceId: 'abc',
        voiceIdMismatch: false,
        category: 'generated',
        resolvedName: 'Meenakshi',
        voiceType: 'voice_design',
        gender: 'female',
        language: 'ta',
        // ElevenLabs listed nothing for this voice's fine-tune support —
        // this is annotation data, not the option list (that's the
        // account-wide catalog from listAvailableModels).
        availableModels: [],
        recommendedModel: null,
        modelOptions: [],
      });
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('passes through the fine-tune-supported models, and recommends multilingual v2 for a PVC voice', async () => {
      mockFetchByUrl(
        {
          voice_id: 'abc',
          category: 'professional',
          name: 'Raju',
          labels: {},
          // Deliberately omits eleven_flash_v2_5 from the account-wide
          // catalog below, so that model exercises the "genuinely not
          // listed" (false) case distinctly from turbo_v2_5's "listed, just
          // not THE recommendation" (null) case.
          high_quality_base_model_ids: [
            'eleven_turbo_v2_5',
            'eleven_multilingual_v2',
          ],
        },
        [
          {
            model_id: 'eleven_turbo_v2_5',
            name: 'Eleven Turbo v2.5',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_multilingual_v2',
            name: 'Eleven Multilingual v2',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_flash_v2_5',
            name: 'Eleven Flash v2.5',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_v3',
            name: 'Eleven v3',
            can_do_text_to_speech: true,
          },
        ],
      );

      const result = await service.lookupVoice('abc');

      expect(result.availableModels).toEqual([
        'eleven_turbo_v2_5',
        'eleven_multilingual_v2',
      ]);
      expect(result.recommendedModel).toBe('eleven_multilingual_v2');
      // The catalog comes back pre-labeled: the recommendation is true;
      // turbo_v2_5 is listed but isn't THE recommendation, so null, not a
      // negative; flash_v2_5 is genuinely absent from the fine-tune list, so
      // false; and v3 — never in that list for any voice — is judged by
      // voice TYPE (PVC here), not by the list, so it's flagged too.
      expect(result.modelOptions).toEqual([
        {
          value: 'eleven_turbo_v2_5',
          label: 'Eleven Turbo v2.5',
          recommended: null,
        },
        {
          value: 'eleven_multilingual_v2',
          label: 'Eleven Multilingual v2',
          recommended: true,
        },
        {
          value: 'eleven_flash_v2_5',
          label: 'Eleven Flash v2.5',
          recommended: false,
        },
        { value: 'eleven_v3', label: 'Eleven v3', recommended: false },
      ]);
    });

    // The exact production bug this endpoint was refactored to fix (a real
    // voice, "Meenakshi", Voice Design): an empty fine-tune list must not
    // read as "every model failed a check", and v3 must be judged by voice
    // type, not by that same empty list.
    it('flags nothing when the voice is v3-compatible and ElevenLabs reported no fine-tune data at all', async () => {
      mockFetchByUrl(
        {
          voice_id: 'iA7',
          category: 'generated',
          name: 'Meenakshi',
          labels: {},
        },
        [
          {
            model_id: 'eleven_turbo_v2_5',
            name: 'Eleven Turbo v2.5',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_v3',
            name: 'Eleven v3',
            can_do_text_to_speech: true,
          },
        ],
      );

      const result = await service.lookupVoice('iA7');

      expect(result.availableModels).toEqual([]);
      expect(result.recommendedModel).toBeNull();
      expect(result.modelOptions).toEqual([
        {
          value: 'eleven_turbo_v2_5',
          label: 'Eleven Turbo v2.5',
          recommended: null,
        },
        { value: 'eleven_v3', label: 'Eleven v3', recommended: null },
      ]);
    });

    it('flags a mismatch when ElevenLabs resolves the id to a different voice', async () => {
      mockFetchByUrl({
        voice_id: 'eLDc7xhWxG2FElT3kUTj',
        category: 'generated',
        name: 'Janet',
        labels: {},
      });

      const result = await service.lookupVoice('21m00Tcm4TlvDq8ikWAM');

      expect(result.voiceIdMismatch).toBe(true);
      expect(result.resolvedVoiceId).toBe('eLDc7xhWxG2FElT3kUTj');
    });

    it('rejects a blank id without calling ElevenLabs', async () => {
      await expect(service.lookupVoice('  ')).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when ElevenLabs is not configured on this environment', async () => {
      configService.voicePreview.elevenlabsApiKey = undefined;
      await expect(service.lookupVoice('abc')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('bulkSyncAllVoices', () => {
    const voiceListingResponse = (voices: any[], hasMore = false) => ({
      ok: true,
      json: async () => ({ voices, has_more: hasMore }),
    });

    it('updates rows whose stored id is in the workspace listing, with no per-voice call', async () => {
      fetchMock.mockResolvedValueOnce(
        voiceListingResponse([
          { voice_id: 'v1', category: 'professional', name: 'Raju' },
          { voice_id: 'v2', category: 'generated', name: 'Meenakshi' },
        ]),
      );
      repository.find.mockResolvedValue([
        {
          id: 'row-1',
          name: 'Raju - Hindi v3',
          config: { voice_id: 'v1', model: 'eleven_v3' },
        },
        {
          id: 'row-2',
          name: 'Meenakshi - Tamil v3',
          config: { voice_id: 'v2', voice_type: 'voice_design' },
        },
      ]);

      const summary = await service.bulkSyncAllVoices();

      expect(summary).toEqual({
        checked: 2,
        updated: 1, // row-2 already had the right voice_type — only row-1 changes
        mismatched: [],
        failed: [],
      });
      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith('row-1', {
        config: { voice_id: 'v1', model: 'eleven_v3', voice_type: 'pvc' },
      });
      // The listing call plus zero per-voice fallbacks — the whole point of the
      // fast path.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to a single-voice fetch only for ids missing from the listing', async () => {
      fetchMock
        .mockResolvedValueOnce(
          voiceListingResponse([
            {
              voice_id: 'eLDc7xhWxG2FElT3kUTj',
              category: 'generated',
              name: 'Janet',
            },
          ]),
        )
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            voice_id: 'eLDc7xhWxG2FElT3kUTj',
            category: 'generated',
            name: 'Janet',
          }),
        });
      repository.find.mockResolvedValue([
        {
          id: 'row-3',
          name: 'Priya (public Rachel id)',
          provider: TtsProvider.ELEVENLABS,
          config: { voice_id: '21m00Tcm4TlvDq8ikWAM' },
        },
      ]);
      repository.findOne.mockResolvedValue({
        id: 'row-3',
        provider: TtsProvider.ELEVENLABS,
        config: { voice_id: '21m00Tcm4TlvDq8ikWAM' },
      });

      const summary = await service.bulkSyncAllVoices();

      expect(summary.checked).toBe(1);
      expect(summary.mismatched).toEqual([
        {
          voiceId: 'row-3',
          name: 'Priya (public Rachel id)',
          storedVoiceId: '21m00Tcm4TlvDq8ikWAM',
          resolvedVoiceId: 'eLDc7xhWxG2FElT3kUTj',
          resolvedName: 'Janet',
        },
      ]);
      expect(summary.failed).toEqual([]);
      // Listing (1) + the fallback's voice fetch (1). Bulk reads only
      // voice_type, so it opts out of the account-wide catalog fetch —
      // otherwise every fallback row would re-fetch the same catalog and
      // discard it.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not re-fetch the account-wide catalog once per fallback row', async () => {
      // The catalog is identical for every row, and bulk reads only
      // voice_type — modelOptions is discarded. Fetching it per row was pure
      // waste that grew with the number of ids missing from the listing (7 of
      // 77 in production), so the /models endpoint must not be touched here.
      fetchMock
        .mockResolvedValueOnce(voiceListingResponse([]))
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            voice_id: 'resolved-id',
            category: 'professional',
            name: 'Whoever',
          }),
        });
      const rows = ['row-a', 'row-b', 'row-c'].map((id) => ({
        id,
        name: id,
        provider: TtsProvider.ELEVENLABS,
        config: { voice_id: `${id}-voice-id` },
      }));
      repository.find.mockResolvedValue(rows);
      repository.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(rows.find((r) => r.id === where.id)),
      );

      await service.bulkSyncAllVoices();

      const modelsCalls = fetchMock.mock.calls.filter(([url]: any[]) =>
        String(url).includes('/models'),
      );
      expect(modelsCalls).toHaveLength(0);
    });

    it('reports a truly bad id as failed, not mismatched', async () => {
      fetchMock
        .mockResolvedValueOnce(voiceListingResponse([]))
        .mockResolvedValueOnce({ ok: false, status: 400 });
      repository.find.mockResolvedValue([
        {
          id: 'row-4',
          name: 'Bad Voice',
          provider: TtsProvider.ELEVENLABS,
          config: { voice_id: 'not-a-real-id' },
        },
      ]);
      repository.findOne.mockResolvedValue({
        id: 'row-4',
        provider: TtsProvider.ELEVENLABS,
        config: { voice_id: 'not-a-real-id' },
      });

      const summary = await service.bulkSyncAllVoices();

      expect(summary.mismatched).toEqual([]);
      expect(summary.failed).toHaveLength(1);
      expect(summary.failed[0]).toMatchObject({
        voiceId: 'row-4',
        storedVoiceId: 'not-a-real-id',
      });
    });

    it('pages through the listing until has_more is false', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            voices: [{ voice_id: 'v1', category: 'premade', name: 'A' }],
            has_more: true,
            next_page_token: 'page-2',
          }),
        })
        .mockResolvedValueOnce(
          voiceListingResponse([
            { voice_id: 'v2', category: 'professional', name: 'B' },
          ]),
        );
      repository.find.mockResolvedValue([
        { id: 'row-5', name: 'B voice', config: { voice_id: 'v2' } },
      ]);

      const summary = await service.bulkSyncAllVoices();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain('next_page_token=page-2');
      expect(summary.updated).toBe(1);
    });

    it('skips rows with no stored voice id', async () => {
      fetchMock.mockResolvedValueOnce(voiceListingResponse([]));
      repository.find.mockResolvedValue([
        { id: 'row-6', name: 'Empty config', config: {} },
      ]);

      const summary = await service.bulkSyncAllVoices();

      expect(summary.checked).toBe(0);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects when ElevenLabs is not configured on this environment', async () => {
      configService.voicePreview.elevenlabsApiKey = undefined;
      await expect(service.bulkSyncAllVoices()).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.find).not.toHaveBeenCalled();
    });
  });

  describe('listAvailableModels', () => {
    it('keeps only text-to-speech-capable models, dropping voice-conversion-only ones', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            model_id: 'eleven_v3',
            name: 'Eleven v3',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_multilingual_v2',
            name: 'Eleven Multilingual v2',
            can_do_text_to_speech: true,
          },
          {
            model_id: 'eleven_english_sts_v2',
            name: 'Eleven English v2',
            can_do_text_to_speech: false,
          },
        ],
      });

      const result = await service.listAvailableModels();

      expect(result).toEqual([
        { modelId: 'eleven_v3', name: 'Eleven v3' },
        { modelId: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
      ]);
    });

    it('is a single account-wide call, not per-voice', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

      await service.listAvailableModels();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('/v1/models');
    });

    it('rejects when ElevenLabs is not configured on this environment', async () => {
      configService.voicePreview.elevenlabsApiKey = undefined;
      await expect(service.listAvailableModels()).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a non-200 from ElevenLabs rather than returning an empty list', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      await expect(service.listAvailableModels()).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
