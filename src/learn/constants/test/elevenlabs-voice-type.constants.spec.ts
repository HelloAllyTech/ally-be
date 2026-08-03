import {
  ELEVENLABS_CATEGORY_TO_VOICE_TYPE,
  ElevenLabsVoiceType,
  getElevenLabsV3Warning,
  isElevenLabsV3Model,
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

describe('getElevenLabsV3Warning', () => {
  // Warning, not error: a same-voice A/B of the fine-tuned v2 render against the
  // v3 fallback was perceptually identical, so blocking the save would discard
  // deliberate work on no evidence of harm.
  // States the mechanism without prescribing a model: v3 genuinely renders
  // these voices (measured), so recommending v2 would overstate the evidence.
  it('warns for a PVC on v3, naming the consequence but not prescribing', () => {
    const w = getElevenLabsV3Warning('eleven_v3', ElevenLabsVoiceType.PVC);
    expect(w).toMatch(/custom-trained from real recordings/i);
    // The consequence a reader can act on: audible similarity, not a mechanism.
    expect(w).toMatch(/will still speak/i);
    expect(w).toMatch(/not sound as close to the original person/i);
    expect(w).toMatch(/listen to it/i);
    // Must not claim v3 cannot render it — it can, and does.
    expect(w).not.toMatch(/cannot use this voice/i);
  });

  it('warns when the type is unrecorded, since silence is how this went unnoticed', () => {
    for (const t of [null, '']) {
      const w = getElevenLabsV3Warning('eleven_v3', t);
      expect(w).toMatch(/do not know how this voice was created/i);
      // Must name the action that resolves it, or the reader is stuck.
      expect(w).toMatch(/Sync from ElevenLabs/i);
    }
  });

  it('warns for an ambiguous category rather than assuming', () => {
    expect(
      getElevenLabsV3Warning('eleven_v3', ElevenLabsVoiceType.UNKNOWN),
    ).toMatch(/did not tell us how this voice was created/i);
  });

  // These strings are read by studio users configuring a voice, who cannot act
  // on our vocabulary. Guarding the whole set rather than one message, because
  // the jargon crept in one message at a time.
  it.each([
    ElevenLabsVoiceType.PVC,
    ElevenLabsVoiceType.UNKNOWN,
    null,
  ])('keeps internal vocabulary out of the %s message', (type) => {
    const w = getElevenLabsV3Warning('eleven_v3', type) ?? '';
    expect(w).not.toMatch(/\bPVC\b|\bIVC\b/);
    expect(w).not.toMatch(/fine-tun/i);
    expect(w).not.toMatch(/\brender/i);
    // "the v3 model" is fine; raw model ids are not.
    expect(w).not.toMatch(/eleven_/);
  });

  it.each([
    ElevenLabsVoiceType.IVC,
    ElevenLabsVoiceType.VOICE_DESIGN,
    ElevenLabsVoiceType.PREMADE,
  ])('stays silent for %s on v3', (type) => {
    expect(getElevenLabsV3Warning('eleven_v3', type)).toBeNull();
  });

  // A PVC on v2 is the correct, fine-tuned configuration — nothing to say.
  it('stays silent for any voice type on a v2 model', () => {
    expect(
      getElevenLabsV3Warning('eleven_multilingual_v2', ElevenLabsVoiceType.PVC),
    ).toBeNull();
    expect(getElevenLabsV3Warning('eleven_flash_v2_5', null)).toBeNull();
  });
});
