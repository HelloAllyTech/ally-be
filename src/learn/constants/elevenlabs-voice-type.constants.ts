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

/** Voice types `eleven_v3` can actually render from. */
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
 * The wording states the mechanism and stops short of recommending a model. v3
 * genuinely renders these voices — we measured 200s and indistinguishable audio
 * — so "keep it on v2" would be advice the evidence does not support. What is
 * certain is only that the fine-tune goes unused.
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
    return 'This voice runs eleven_v3 but its voice type is unrecorded. Sync it from ElevenLabs — v3 cannot use a Professional Voice Clone and will silently substitute a lower-fidelity render.';
  }
  if (type === ElevenLabsVoiceType.UNKNOWN) {
    return 'ElevenLabs did not report a category that distinguishes an Instant from a Professional clone. Confirm in the ElevenLabs workspace which flow created this voice — v3 cannot use a Professional Voice Clone.';
  }
  if (!V3_COMPATIBLE_VOICE_TYPES.includes(type as ElevenLabsVoiceType)) {
    return `eleven_v3 will not use this ${type.toUpperCase()} voice's fine-tuned model — it renders from the first ~30-90s of the training audio instead. It still returns audio and may sound close, so judge it by ear. Only eleven_multilingual_v2 uses the fine-tune.`;
  }
  return null;
};
