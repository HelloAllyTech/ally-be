/**
 * Hosted video-actor providers a roleplay can pick between.
 *
 * Must stay in sync with `HOSTED_PROVIDER_MODULES` in
 * `ally-ai-learn/app/core/livekit/video_actor.py`. A roleplay stored with any
 * other value cannot render: the worker logs an unknown-provider warning and
 * runs the session audio-only, which the learner sees as the ordinary static
 * call card.
 *
 * Stored lower-case, matching the values the worker compares against and the
 * `VIDEO_ACTOR_PROVIDER` env var it falls back to. Unlike `TtsProvider` the
 * runtime does NOT normalise casing here, so this casing is load-bearing.
 *
 * Deliberately excludes:
 * - `test_pattern`, the in-process numpy placeholder. It is not AI-generated
 *   video and must never be selectable for a real cohort; it stays an env-only
 *   opt-in for exercising the publish path without a vendor account.
 * - `anam` and `simli`, which the abstraction supports but whose plugins are
 *   not installed, so picking one would silently degrade to audio-only.
 */
export enum VideoActorProvider {
  BEY = 'bey',
  TAVUS = 'tavus',
}

/** Vendor display names. The picker shows these; the enum value is stored. */
export const VIDEO_ACTOR_PROVIDER_LABELS: Record<VideoActorProvider, string> = {
  [VideoActorProvider.BEY]: 'Beyond Presence',
  [VideoActorProvider.TAVUS]: 'Tavus',
};
