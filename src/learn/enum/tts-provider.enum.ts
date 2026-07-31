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
 * Stored lower-case, matching stt_configs and llm_configs. Rows written before
 * migration 1874000000000 were upper-case, and ally-ai-learn lower-cases before
 * comparing either way, so every comparison here goes through
 * `normalizeProviderKey` rather than assuming a casing.
 */
export enum TtsProvider {
  DEEPGRAM = 'deepgram',
  ELEVENLABS = 'elevenlabs',
  SARVAM = 'sarvam',
  GOOGLE = 'google',
  HUME = 'hume',
}

/**
 * Canonical form for comparing a provider value from any source — a stored
 * row, a query-string filter, or a request body. Keeps the code correct
 * whichever side of the casing migration the data is on.
 */
export const normalizeProviderKey = (provider?: string | null): string =>
  String(provider ?? '').toLowerCase();
