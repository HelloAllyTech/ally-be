/**
 * Translation Constants
 * Defines language codes, names, and code-mixing configurations
 * for natural, conversational Indian language generation
 */

/**
 * Maps language codes to their full English names
 * Used for constructing LLM prompts
 */
export const LANGUAGE_NAME_MAP: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  gu: 'Gujarati',
  mr: 'Marathi',
  bn: 'Bengali',
  pa: 'Punjabi',
  or: 'Odia',
};

/**
 * Maps language codes to their code-mixed language names (Hinglish, Tanglish, etc.)
 */
export const CODE_MIXED_LANGUAGE_NAME_MAP: Record<string, string> = {
  hi: 'Hinglish (Hindi + English)',
  ta: 'Tanglish (Tamil + English)',
  te: 'Teluglish (Telugu + English)',
  kn: 'Kannadlish (Kannada + English)',
  ml: 'Malenglish (Malayalam + English)',
  gu: 'Gujlish (Gujarati + English)',
  mr: 'Marathinglish (Marathi + English)',
  bn: 'Banglish (Bengali + English)',
  pa: 'Punjlish (Punjabi + English)',
  or: 'Odlish (Odia + English)',
};

/**
 * Common English words and phrases that should be preserved in code-mixed text
 * These are typically tech terms, modern concepts, or universally understood words
 */
export const CODE_MIXING_PRESERVE_WORDS: Record<string, string[]> = {
  hi: [
    'app',
    'okay',
    'hi',
    'hello',
    'thanks',
    'sorry',
    'please',
    'yes',
    'no',
    'good',
    'bad',
    'nice',
    'video',
    'call',
    'message',
    'user',
    'button',
    'click',
    'save',
    'update',
    'delete',
    'create',
    'name',
    'email',
    'password',
  ],
  ta: [
    'app',
    'okay',
    'hi',
    'hello',
    'thanks',
    'sorry',
    'please',
    'yes',
    'no',
    'good',
    'bad',
    'nice',
    'video',
    'call',
    'message',
    'user',
    'button',
    'click',
    'save',
    'update',
    'delete',
  ],
  te: [
    'app',
    'okay',
    'hi',
    'hello',
    'thanks',
    'sorry',
    'please',
    'yes',
    'no',
    'good',
    'video',
    'call',
    'message',
    'user',
  ],
  kn: [
    'app',
    'okay',
    'hi',
    'hello',
    'thanks',
    'sorry',
    'please',
    'yes',
    'no',
    'good',
    'video',
    'call',
  ],
  ml: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'yes', 'no', 'good'],
  gu: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'please', 'yes', 'no'],
  mr: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'please', 'yes', 'no'],
  bn: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'yes', 'no'],
  pa: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'yes', 'no'],
  or: ['app', 'okay', 'hi', 'hello', 'thanks', 'sorry', 'yes', 'no'],
};

/**
 * Language-specific tone and style guidelines for code-mixed generation
 * Provides cultural and linguistic context for natural output
 */
export const LANGUAGE_TONE_GUIDELINES: Record<string, string> = {
  hi: `
Spoken, casual Hindi in Devanagari.
Native script must dominate.
Light Hinglish allowed only where natural.
Friendly, everyday conversational tone.
Avoid formal, pure, or textbook Hindi.
`,

  ta: `
Spoken, casual Tamil in Tamil script.
Native script must dominate.
Light Tanglish allowed for modern terms.
Natural, friendly conversational flow.
Avoid formal or literary Tamil.
`,

  te: `
Spoken, casual Telugu in Telugu script.
Native script must dominate.
Light Teluglish allowed where natural.
Relaxed, friendly conversation style.
Avoid formal or poetic Telugu.
`,

  kn: `
Spoken, casual Kannada in Kannada script.
Native script must dominate.
Light Kannadlish allowed where natural.
Friendly, everyday conversational tone.
Avoid formal or textbook Kannada.
`,

  ml: `
Spoken, casual Malayalam in Malayalam script.
Native script must dominate.
Light Malenglish allowed where natural.
Natural spoken flow, not written prose.
Avoid formal or news-style Malayalam.
`,

  gu: `
Spoken, casual Gujarati in Gujarati script.
Native script must dominate.
Light Gujlish allowed where natural.
Warm, friendly conversational tone.
Avoid formal or overly pure Gujarati.
`,

  mr: `
Spoken, casual Marathi in Marathi script.
Native script must dominate.
Light Marathinglish allowed where natural.
Relaxed, everyday conversational style.
Avoid formal or official Marathi.
`,

  bn: `
Spoken, casual Bengali in Bengali script.
Native script must dominate.
Light Banglish allowed where natural.
Friendly, natural conversational tone.
Avoid formal or literary Bengali.
`,

  pa: `
Spoken, casual Punjabi in Gurmukhi.
Native script must dominate.
Light Punjlish allowed where natural.
Warm, expressive conversational style.
Avoid formal Punjabi.
`,

  or: `
Spoken, casual Odia in Odia script.
Native script must dominate.
Light Odlish allowed where natural.
Everyday, friendly conversational tone.
Avoid formal or bookish Odia.
`,
};

/**
 * Common formality markers to avoid in code-mixed translation
 * These indicate overly formal/translated content
 */
export const FORMALITY_MARKERS_TO_AVOID: string[] = [
  'hereby',
  'moreover',
  'Furthermore',
  'consequently',
  'thus',
  'nevertheless',
  'whereas',
  'thereof',
  'aforementioned',
  'notwithstanding',
];

/**
 * Supported Indian language codes with their full ISO codes
 */
export const SUPPORTED_INDIAN_LANGUAGES = {
  HINGLISH: { code: 'hi', iso: 'hi-IN', name: 'Hinglish' },
  TANGLISH: { code: 'ta', iso: 'ta-IN', name: 'Tanglish' },
  TELUGLISH: { code: 'te', iso: 'te-IN', name: 'Teluglish' },
  KANNADLISH: { code: 'kn', iso: 'kn-IN', name: 'Kannadlish' },
  MALENGLISH: { code: 'ml', iso: 'ml-IN', name: 'Malenglish' },
  GUJLISH: { code: 'gu', iso: 'gu-IN', name: 'Gujlish' },
  MARATHINGLISH: { code: 'mr', iso: 'mr-IN', name: 'Marathinglish' },
  BANGLISH: { code: 'bn', iso: 'bn-IN', name: 'Banglish' },
  PUNJLISH: { code: 'pa', iso: 'pa-IN', name: 'Punjlish' },
  ODLISH: { code: 'or', iso: 'or-IN', name: 'Odlish' },
};
