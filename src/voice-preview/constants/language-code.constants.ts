/**
 * Non-standard codes that TTS providers (Google, Deepgram, etc.) do not support.
 * Normalize to BCP-47 equivalents before passing to providers.
 */
export const LANGUAGE_CODE_NORMALIZATIONS: Record<string, string> = {};

/**
 * Normalize language code for general TTS providers (Google, Deepgram, Hume, ElevenLabs).
 */
export function normalizeLanguageCodeForProviders(
  code: string | undefined,
): string {
  if (!code || typeof code !== 'string') {
    return 'en-US';
  }
  const key = code.trim();
  return LANGUAGE_CODE_NORMALIZATIONS[key] ?? key;
}

/**
 * Sarvam TTS only supports specific language codes.
 * - English: en-IN (not en-GB, en-US)
 * - Odia: od-IN (not or-IN)
 * Maps unsupported codes to Sarvam's supported equivalents.
 */
export const SARVAM_LANGUAGE_CODE_MAP: Record<string, string> = {
  'en-GB': 'en-IN',
  'en-US': 'en-IN',
  'or-IN': 'od-IN',
  or: 'od-IN',
};

/**
 * Convert a BCP-47 language code to the format expected by Sarvam TTS API.
 * Sarvam does not support en-GB, en-US (use en-IN) or or-IN (use od-IN).
 */
export function convertLanguageCodeForSarvam(code: string | undefined): string {
  if (!code || typeof code !== 'string') {
    return 'en-IN';
  }
  const key = code.trim();
  return SARVAM_LANGUAGE_CODE_MAP[key] ?? key;
}
