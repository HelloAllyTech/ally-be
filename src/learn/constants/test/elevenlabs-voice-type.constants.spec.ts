import {
  buildElevenLabsModelOptions,
  ELEVENLABS_CATEGORY_TO_VOICE_TYPE,
  ElevenLabsVoiceType,
  isElevenLabsV3Model,
  getElevenLabsModelRecommendation,
} from '../elevenlabs-voice-type.constants';

describe('ElevenLabs category mapping', () => {
  // Measured against the live workspace: 153 voices returned professional /
  // premade / generated and NO `cloned`, despite support saying `cloned` covers
  // both clone types. `professional` is therefore the PVC marker.
  it('maps the categories the account actually returns', () => {
    expect(ELEVENLABS_CATEGORY_TO_VOICE_TYPE.professional).toBe(
      ElevenLabsVoiceType.PVC,
    );
    expect(ELEVENLABS_CATEGORY_TO_VOICE_TYPE.premade).toBe(
      ElevenLabsVoiceType.PREMADE,
    );
    expect(ELEVENLABS_CATEGORY_TO_VOICE_TYPE.generated).toBe(
      ElevenLabsVoiceType.VOICE_DESIGN,
    );
  });

  // If `cloned` ever appears it is genuinely ambiguous, so it must not be
  // assumed v3-safe.
  it('treats cloned as unknown rather than guessing', () => {
    expect(ELEVENLABS_CATEGORY_TO_VOICE_TYPE.cloned).toBe(
      ElevenLabsVoiceType.UNKNOWN,
    );
  });
});

describe('isElevenLabsV3Model', () => {
  it.each(['eleven_v3', 'ELEVEN_V3', 'eleven_v3_preview'])(
    'detects %s',
    (m) => {
      expect(isElevenLabsV3Model(m)).toBe(true);
    },
  );

  it.each([
    'eleven_multilingual_v2',
    'eleven_flash_v2_5',
    'eleven_turbo_v2',
    '',
    null,
  ])('does not misread %s as v3', (m) => {
    expect(isElevenLabsV3Model(m as string)).toBe(false);
  });
});

describe('buildElevenLabsModelOptions', () => {
  // ElevenLabs: "high_quality_base_model_ids... won't include v3 for any
  // voice type today" — because it lists fine-tuned models and v3 uses none.
  // Not a rejection of the voice (the call still returns 200). So this is
  // annotation data (which of the account-wide models this voice's fine-tune
  // supports), not the option list itself — the option list is the account-
  // wide GET /v1/models catalog, built elsewhere by listAvailableModels.
  it('passes through exactly what ElevenLabs listed, with no synthetic additions', () => {
    const { availableModels } = buildElevenLabsModelOptions(
      undefined,
      ElevenLabsVoiceType.VOICE_DESIGN,
    );
    expect(availableModels).toEqual([]);
  });

  it('does not add v3 even if the fine-tune list never carries it', () => {
    const { availableModels } = buildElevenLabsModelOptions(
      ['eleven_turbo_v2_5'],
      ElevenLabsVoiceType.PREMADE,
    );
    expect(availableModels).toEqual(['eleven_turbo_v2_5']);
  });

  // ElevenLabs' own migration guidance: stay on Multilingual v2 for voices
  // where fidelity to an existing Professional clone matters.
  it('recommends multilingual v2 for a PVC voice when ElevenLabs lists it', () => {
    const { recommendedModel } = buildElevenLabsModelOptions(
      ['eleven_turbo_v2_5', 'eleven_multilingual_v2'],
      ElevenLabsVoiceType.PVC,
    );
    expect(recommendedModel).toBe('eleven_multilingual_v2');
  });

  it('never recommends v3 — adopting it is a deliberate content decision', () => {
    const { recommendedModel } = buildElevenLabsModelOptions(
      [],
      ElevenLabsVoiceType.VOICE_DESIGN,
    );
    expect(recommendedModel).not.toBe('eleven_v3');
    expect(recommendedModel).toBeNull();
  });

  it('falls back to whatever ElevenLabs lists first for a non-PVC voice', () => {
    const { recommendedModel } = buildElevenLabsModelOptions(
      ['eleven_flash_v2_5', 'eleven_turbo_v2_5'],
      ElevenLabsVoiceType.IVC,
    );
    expect(recommendedModel).toBe('eleven_flash_v2_5');
  });

  it('does not recommend multilingual v2 for a PVC voice ElevenLabs never listed it for', () => {
    const { recommendedModel } = buildElevenLabsModelOptions(
      ['eleven_turbo_v2_5'],
      ElevenLabsVoiceType.PVC,
    );
    expect(recommendedModel).toBe('eleven_turbo_v2_5');
  });
});

describe('getElevenLabsModelRecommendation', () => {
  const CATALOG_V3 = 'eleven_v3';

  // Today: v3 appears in no voice's fine-tune list (0 of 153 measured), so the
  // verdict falls back to voice type — flagged for a PVC, silent otherwise.
  it('flags v3 for a PVC while ElevenLabs lists it for nobody', () => {
    expect(
      getElevenLabsModelRecommendation(
        CATALOG_V3,
        ElevenLabsVoiceType.PVC,
        ['eleven_multilingual_v2'],
        'eleven_multilingual_v2',
      ),
    ).toBe(false);
  });

  it('stays silent about v3 for a voice type it suits', () => {
    expect(
      getElevenLabsModelRecommendation(
        CATALOG_V3,
        ElevenLabsVoiceType.VOICE_DESIGN,
        [],
        null,
      ),
    ).toBeNull();
  });

  /**
   * ElevenLabs' wording is that v3 "doesn't YET support Professional Voice
   * Clones". When that changes, v3 should start appearing in a PVC voice's
   * fine-tune list — and their data has to win over our hardcoded assumption,
   * or we would go on flagging v3 for PVCs after it became the right choice,
   * with nothing to reveal it.
   */
  it('stops flagging v3 for a PVC once ElevenLabs lists it for that voice', () => {
    expect(
      getElevenLabsModelRecommendation(
        CATALOG_V3,
        ElevenLabsVoiceType.PVC,
        ['eleven_multilingual_v2', CATALOG_V3],
        'eleven_multilingual_v2',
      ),
    ).toBeNull();
  });

  it('promotes v3 for a PVC if ElevenLabs makes it the recommendation outright', () => {
    expect(
      getElevenLabsModelRecommendation(
        CATALOG_V3,
        ElevenLabsVoiceType.PVC,
        [CATALOG_V3],
        CATALOG_V3,
      ),
    ).toBe(true);
  });

  // Absence of data is not a verdict: an empty list means ElevenLabs reported
  // nothing for this voice, true of every Voice Design voice.
  it('reports no verdict for a non-v3 model when the fine-tune list is empty', () => {
    expect(
      getElevenLabsModelRecommendation(
        'eleven_turbo_v2_5',
        ElevenLabsVoiceType.VOICE_DESIGN,
        [],
        null,
      ),
    ).toBeNull();
  });

  it('flags a non-v3 model ElevenLabs left out of a list it did populate', () => {
    expect(
      getElevenLabsModelRecommendation(
        'eleven_turbo_v2',
        ElevenLabsVoiceType.PVC,
        ['eleven_multilingual_v2'],
        'eleven_multilingual_v2',
      ),
    ).toBe(false);
  });
});
