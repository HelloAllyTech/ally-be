interface LanguageLike {
  id: number;
  label: string;
  value: string;
}

interface ScenarioWithLanguageMetadata {
  metadata?: {
    languageVoices?: Record<string, unknown> | null;
  } | null;
  scenario_metadata?: {
    languageVoices?: Record<string, unknown> | null;
  } | null;
}

export interface AvailableLanguageItem {
  language_id: number;
  label: string;
  value: string;
}

/**
 * The catalog voices that still exist and are active, as voice id → the
 * language they belong to. See SharedLanguageService.getActiveScenarioVoices.
 */
export type ActiveVoiceMap = Map<string, number>;

const languageVoicesOf = (scenario: ScenarioWithLanguageMetadata) =>
  scenario?.metadata?.languageVoices ||
  scenario?.scenario_metadata?.languageVoices;

/**
 * The languages a scenario offers, read off its `languageVoices` map.
 *
 * Studio only ever shows a language as configured when the voice it maps to
 * is an active catalog voice for that language; a mapping left behind by a
 * deleted or deactivated voice is invisible there. Pass `activeVoices` to
 * apply the same rule here, so learners are offered exactly what Studio
 * shows. Without it, every non-null mapping counts (the legacy reading).
 */
export const getLanguageVoiceIds = (
  languageVoices?: Record<string, unknown> | null,
  activeVoices?: ActiveVoiceMap,
): number[] =>
  Object.entries(languageVoices ?? {})
    .filter(([, voice]) => voice !== null && voice !== undefined)
    .map(([languageId, voice]) => [Number(languageId), voice] as const)
    .filter(
      ([languageId, voice]) =>
        Number.isInteger(languageId) &&
        (!activeVoices ||
          (typeof voice === 'string' &&
            activeVoices.get(voice) === languageId)),
    )
    .map(([languageId]) => languageId);

export const getDistinctScenarioLanguageIds = (
  scenarios: ScenarioWithLanguageMetadata[],
  activeVoices?: ActiveVoiceMap,
): number[] => [
  ...new Set(
    scenarios.flatMap((scenario) =>
      getLanguageVoiceIds(languageVoicesOf(scenario), activeVoices),
    ),
  ),
];

/** Every voice id these scenarios map a language to, for one catalog lookup. */
export const getDistinctScenarioVoiceIds = (
  scenarios: ScenarioWithLanguageMetadata[],
): string[] => [
  ...new Set(
    scenarios.flatMap((scenario) =>
      Object.values(languageVoicesOf(scenario) ?? {}).filter(
        (voice): voice is string => typeof voice === 'string' && voice !== '',
      ),
    ),
  ),
];

export const buildAvailableLanguagesMap = (
  languages: LanguageLike[],
): Map<number, AvailableLanguageItem> =>
  new Map(
    languages.map((language) => [
      language.id,
      {
        language_id: language.id,
        label: language.label,
        value: language.value,
      },
    ]),
  );
