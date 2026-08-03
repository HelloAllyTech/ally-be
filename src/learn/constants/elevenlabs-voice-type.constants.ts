/**
 * How an ElevenLabs voice was created, which is what decides whether
 * `eleven_v3` can use it.
 *
 * v3 does not support fine-tuned models. A Professional Voice Clone IS a
 * fine-tuned model, so v3 silently substitutes an Instant-Voice-Clone-style
 * render built from the first ~30-90s of the voice's training audio. The call
 * returns 200 with plausible audio, so nothing errors, nothing logs, and no
 * test can catch it — measured against production: 4/4 v3+PVC previews returned
 * 200 with byte counts and latencies indistinguishable from working configs.
 *
 * Recorded rather than derived because neither the model string nor the voice id
 * reveals it. It comes from the ElevenLabs API's `category`, which is why the
 * sync exists.
 */
export enum ElevenLabsVoiceType {
  /** Professional Voice Clone — fine-tuned, so NOT usable by v3. */
  PVC = 'pvc',
  /** Instant Voice Clone — no fine-tuning, v3-compatible. */
  IVC = 'ivc',
  /** Voice Design / generated — v3-compatible. */
  VOICE_DESIGN = 'voice_design',
  /** ElevenLabs stock voice — v3-compatible. */
  PREMADE = 'premade',
  /** Fetched but the API's answer does not settle IVC vs PVC. Needs a human. */
  UNKNOWN = 'unknown',
}

/**
 * ElevenLabs `category` → our voice type.
 *
 * NOTE: ElevenLabs support told us `category: "cloned"` covers both IVC and PVC.
 * That is not what this account returns — across 153 voices the categories are
 * `professional` (105), `premade` (21) and `generated` (27), with no `cloned` at
 * all. `professional` is therefore treated as the definitive PVC marker, and
 * `cloned` is mapped to UNKNOWN so that if it ever does appear it is flagged for
 * a human rather than silently assumed safe.
 *
 * This mapping is the one open question with ElevenLabs; see the follow-up list
 * in the voice-config notes.
 */
export const ELEVENLABS_CATEGORY_TO_VOICE_TYPE: Record<
  string,
  ElevenLabsVoiceType
> = {
  professional: ElevenLabsVoiceType.PVC,
  premade: ElevenLabsVoiceType.PREMADE,
  generated: ElevenLabsVoiceType.VOICE_DESIGN,
  cloned: ElevenLabsVoiceType.UNKNOWN,
};

/**
 * Voice types we stay silent about on v3.
 *
 * Not "types v3 can use a fine-tune from" — there are none. ElevenLabs
 * confirmed that `high_quality_base_model_ids` lists fine-tuned models and
 * "won't include v3 for any voice type today", so v3 uses no per-voice
 * fine-tune at all. Our own sweep agrees: v3 appears on 0 of 153 voices.
 *
 * So the real question is not whether a fine-tune is bypassed but whether
 * losing it matters. For a professional clone the fine-tune IS the likeness to
 * a specific real person, so losing it is audible against a reference the
 * listener may know. For a stock or Voice-Design voice there is no such
 * reference — nothing is being matched — which is why those stay silent even
 * though stock voices do carry fine-tunes (19 of 21 on this account).
 *
 * PREMADE was previously listed here on the assumption that v3 renders stock
 * voices itself. The conclusion held; the stated reason was wrong.
 */
export const V3_COMPATIBLE_VOICE_TYPES: ElevenLabsVoiceType[] = [
  ElevenLabsVoiceType.IVC,
  ElevenLabsVoiceType.VOICE_DESIGN,
  ElevenLabsVoiceType.PREMADE,
];

/** Whether a model string names an ElevenLabs v3 model. */
export const isElevenLabsV3Model = (model?: string | null): boolean =>
  /v3/i.test(String(model ?? ''));

/**
 * Warning for a voice whose fine-tune v3 will not use — deliberately a warning,
 * not an error, and deliberately non-prescriptive.
 *
 * A same-voice A/B (fine-tuned v2 vs v3 fallback, identical Hindi sentence) was
 * perceptually identical, so the combination is *unsupported* rather than
 * demonstrably broken. Blocking the save would discard deliberate work on no
 * evidence of harm; staying silent is what let 23 production rows end up here
 * unnoticed.
 *
 * The wording stops short of recommending a model. v3 genuinely renders these
 * voices — we measured 200s and indistinguishable audio — so "keep it on v2"
 * would be advice the evidence does not support. What is certain is only that
 * the fine-tune goes unused.
 *
 * Written for a studio user, not an engineer: no "PVC", "fine-tune" or
 * "render". The reader configuring a voice cannot act on our vocabulary, only
 * on what will happen and what to do about it — which is why every message
 * ends in an instruction. An earlier draft said "eleven_v3 will not use this
 * PVC voice's fine-tuned model", which is precise and unreadable.
 *
 * Returns null when there is nothing to say.
 */
export const getElevenLabsV3Warning = (
  model?: string | null,
  voiceType?: string | null,
): string | null => {
  if (!isElevenLabsV3Model(model)) return null;

  const type = String(voiceType ?? '').trim();
  if (!type) {
    return 'We do not know how this voice was created, so we cannot say how it will sound on the v3 model. Click "Sync from ElevenLabs" to check.';
  }
  if (type === ElevenLabsVoiceType.UNKNOWN) {
    return 'ElevenLabs did not tell us how this voice was created. Check in the ElevenLabs workspace whether it was trained from recordings — if it was, v3 will not sound as close to the original person.';
  }
  if (!V3_COMPATIBLE_VOICE_TYPES.includes(type as ElevenLabsVoiceType)) {
    return 'This voice was custom-trained from real recordings. The v3 model cannot use that training — it will still speak, but it will not sound as close to the original person. Listen to it before you use it.';
  }
  return null;
};

/** ElevenLabs never lists this in a voice's own model support, for any voice. */
const ELEVENLABS_V3_MODEL = 'eleven_v3';
/** The model that uses a Professional clone's fine-tune. */
const ELEVENLABS_FIDELITY_MODEL = 'eleven_multilingual_v2';

export interface ElevenLabsModelOptions {
  /** Models to offer a picker for this voice. */
  availableModels: string[];
  /** A safe starting point, or null when there's nothing to prefer. */
  recommendedModel: string | null;
}

/**
 * Which models to offer for a voice, and which one to default to — both
 * derived from what ElevenLabs told us, not chosen freehand.
 *
 * `availableModels` starts from the voice's own `high_quality_base_model_ids`
 * (ElevenLabs' real, per-voice answer) and always appends v3: ElevenLabs
 * confirmed that field "won't include v3 for any voice type today" because v3
 * uses no per-voice fine-tune at all, not because v3 rejects the voice — the
 * call still returns 200. Its risk is carried by `getElevenLabsV3Warning`, not
 * by leaving it off this list.
 *
 * `recommendedModel` follows ElevenLabs' own migration guidance: where
 * speaker fidelity to an existing Professional clone matters, stay on
 * Multilingual v2 rather than v3 for now. So a PVC voice defaults to
 * Multilingual v2 when ElevenLabs lists it as supported; anything else
 * defaults to whatever ElevenLabs lists first — never to v3, since adopting
 * it is a deliberate content decision (their words: "adopt v3 selectively …
 * for content where the emotional range is the priority"), not a safe default.
 */
export const buildElevenLabsModelOptions = (
  highQualityBaseModelIds: string[] | undefined | null,
  voiceType: ElevenLabsVoiceType | string | null,
): ElevenLabsModelOptions => {
  const listed = (highQualityBaseModelIds ?? []).filter(Boolean);
  const availableModels = listed.includes(ELEVENLABS_V3_MODEL)
    ? listed
    : [...listed, ELEVENLABS_V3_MODEL];

  const recommendedModel =
    voiceType === ElevenLabsVoiceType.PVC && listed.includes(ELEVENLABS_FIDELITY_MODEL)
      ? ELEVENLABS_FIDELITY_MODEL
      : (listed[0] ?? null);

  return { availableModels, recommendedModel };
};
