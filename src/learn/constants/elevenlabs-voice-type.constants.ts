import { Gender } from '../enum/gender.enum';

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
 * ElevenLabs' `labels.gender` narrowed to a value our own schema accepts, or
 * null when it doesn't map.
 *
 * Their label is free text and ours is an enum, so the two are not the same
 * vocabulary: across 153 voices this account returns `male` (71), `female`
 * (60), nothing at all (21) — and `neutral` (1, "River"). Handing `neutral`
 * straight through autofills a value the Gender dropdown cannot display and
 * that both validators then reject, so the admin gets Save blocked over a
 * field they never touched.
 *
 * `neutral` is deliberately NOT mapped to `non-binary`. A gender-neutral voice
 * is a statement about how the audio sounds; non-binary is a statement about a
 * person's identity. Equating them would assert something ElevenLabs never
 * said, so an unmappable label leaves the field unset for a human to choose —
 * which the studio already flags as a non-blocking "no gender set" warning.
 */
export const toScenarioVoiceGender = (label?: string | null): Gender | null => {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase();
  return (Object.values(Gender) as string[]).includes(normalized)
    ? (normalized as Gender)
    : null;
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
 * Whether v3 is a sound choice for a voice of this type — what
 * `getElevenLabsModelRecommendation` defers to, so the per-voice model verdict
 * this service returns is decided in one place.
 *
 * This file used to also own `getElevenLabsV3Warning`, which produced the
 * studio's advisory text from the same rule. That copy was dead: it populated a
 * `warning` field on the sync response that no client ever rendered, and it had
 * already drifted (it still named a button the studio renamed). The studio
 * keeps its own copy on purpose — the advisory has to appear the instant an
 * admin flips the Model dropdown, and to work off the persisted `voice_type` of
 * a voice nobody has re-synced, neither of which a server round-trip can do.
 * The per-voice model verdict is the opposite case and correctly lives here: it
 * needs ElevenLabs' `high_quality_base_model_ids`, which only this service can
 * fetch.
 */
export const isElevenLabsV3CompatibleVoiceType = (
  voiceType?: string | null,
): boolean =>
  V3_COMPATIBLE_VOICE_TYPES.includes(
    String(voiceType ?? '').trim() as ElevenLabsVoiceType,
  );

/** The model that uses a Professional clone's fine-tune. */
const ELEVENLABS_FIDELITY_MODEL = 'eleven_multilingual_v2';

export interface ElevenLabsModelOptions {
  /**
   * Models THIS voice's fine-tune actually supports, per ElevenLabs —
   * annotation data, not the option list. `GET /v1/models` (account-wide,
   * confirmed via `listAvailableModels`) is what the picker's options come
   * from; v3 is real and selectable there even though it's never in this
   * list — v3 uses no per-voice fine-tune at all, for any voice, so its
   * absence here isn't ElevenLabs rejecting the voice.
   */
  availableModels: string[];
  /** A safe starting point, or null when there's nothing to prefer. */
  recommendedModel: string | null;
}

/**
 * Which model THIS voice's fine-tune supports, and which one to default to —
 * both derived from what ElevenLabs told us, not chosen freehand.
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

  const recommendedModel =
    voiceType === ElevenLabsVoiceType.PVC &&
    listed.includes(ELEVENLABS_FIDELITY_MODEL)
      ? ELEVENLABS_FIDELITY_MODEL
      : (listed[0] ?? null);

  return { availableModels: listed, recommendedModel };
};

/** One entry in a picker, with ElevenLabs' own verdict already applied. */
export interface ElevenLabsModelOption {
  value: string;
  label: string;
  /**
   * true = the recommendation for this voice; false = flagged as not
   * recommended; null = no signal either way — ElevenLabs told us nothing
   * that distinguishes this model for this voice, so we don't invent one.
   */
  recommended: boolean | null;
}

/**
 * Whether ONE model deserves a "not recommended" flag for a SPECIFIC voice —
 * the single place this decision is made, so a UI rendering it doesn't need
 * its own copy of the same rule (a duplicate copy is exactly what caused a
 * real production voice, "Meenakshi", to have v3 wrongly flagged: the
 * rendering layer's independent copy of this logic didn't agree with this
 * one).
 *
 * Two things make "not recommended" a real claim rather than a guess:
 *
 * 1. v3 gets its own check, by voice TYPE, not by availableModels: ElevenLabs
 *    confirmed `high_quality_base_model_ids` never lists v3, for ANY voice —
 *    that's a fact about how v3 works, not a per-voice signal, so using it to
 *    judge v3 would flag it for every voice, including ones it suits fine.
 * 2. For every other model, absence from availableModels is only meaningful
 *    when that list has real entries — ElevenLabs actively choosing some
 *    models over others for this voice. An EMPTY list is not a verdict on
 *    every model; it means no fine-tune data was reported at all (true for
 *    every Voice Design voice — 0 of 27 in the account-wide sweep). Flagging
 *    everything from an empty list would claim ElevenLabs said something it
 *    never said.
 */
export const getElevenLabsModelRecommendation = (
  modelId: string,
  voiceType: ElevenLabsVoiceType | string | null,
  availableModels: string[],
  recommendedModel: string | null,
): boolean | null => {
  if (modelId === recommendedModel) return true;
  if (isElevenLabsV3Model(modelId)) {
    return isElevenLabsV3CompatibleVoiceType(voiceType) ? null : false;
  }
  if (availableModels.length > 0 && !availableModels.includes(modelId)) {
    return false;
  }
  return null;
};
