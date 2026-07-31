/**
 * TTS providers the voice agent can actually dispatch to.
 *
 * Must stay in sync with `TTSProvider` in
 * `ally-ai-learn/app/core/constants.py` and the concrete clients under
 * `ally-ai-learn/app/tts/`. A voice stored with any other provider cannot be
 * created at runtime — `create_tts_client()` logs a warning and silently falls
 * back to the default Deepgram voice, so the scenario plays in the wrong voice
 * rather than failing loudly.
 *
 * Stored upper-case to match the existing rows; the runtime lower-cases the
 * value before comparing, so either casing dispatches correctly.
 */
export enum TtsProvider {
  DEEPGRAM = 'DEEPGRAM',
  ELEVENLABS = 'ELEVENLABS',
  SARVAM = 'SARVAM',
  GOOGLE = 'GOOGLE',
  HUME = 'HUME',
}
