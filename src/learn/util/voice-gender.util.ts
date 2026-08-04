import { Gender } from '../enum/gender.enum';

/**
 * A TTS provider's own gender label narrowed to a value our schema accepts, or
 * null when it doesn't map.
 *
 * Every provider publishes this differently and none of them share our
 * vocabulary: ElevenLabs uses a free-text `labels.gender` (across 153 voices on
 * this account: `male` 71, `female` 60, absent 21, and `neutral` 1 — "River"),
 * Google an `ssmlGender` enum that includes NEUTRAL, Hume a `GENDER` tag array
 * with title-cased values. Ours is `male | female | non-binary`, and both
 * validators enforce it exactly, so an unmapped label handed straight through
 * autofills a value the Gender dropdown cannot display and Save then rejects —
 * blocking the admin on a field they never touched.
 *
 * `neutral` is deliberately NOT mapped to `non-binary`. A gender-neutral voice
 * is a statement about how the audio sounds; non-binary is a statement about a
 * person's identity. Equating them would assert something the provider never
 * said. An unmappable label leaves the field unset for a human to choose, which
 * the studio already surfaces as a non-blocking "no gender set" warning.
 */
export const toScenarioVoiceGender = (label?: string | null): Gender | null => {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase();
  return (Object.values(Gender) as string[]).includes(normalized)
    ? (normalized as Gender)
    : null;
};
