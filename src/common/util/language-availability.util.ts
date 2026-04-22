interface LanguageLike {
  id: number;
  label: string;
  value: string;
}

interface ScenarioWithLanguageMetadata {
  metadata?: {
    languageVoices?: Record<string, unknown>;
  };
  scenario_metadata?: {
    languageVoices?: Record<string, unknown>;
  };
}

export interface AvailableLanguageItem {
  language_id: number;
  label: string;
  value: string;
}

export const getLanguageVoiceIds = (
  languageVoices?: Record<string, unknown> | null,
): number[] =>
  Object.keys(languageVoices ?? {})
    .map((languageId) => Number(languageId))
    .filter((languageId) => Number.isInteger(languageId));

export const getDistinctScenarioLanguageIds = (
  scenarios: ScenarioWithLanguageMetadata[],
): number[] => [
  ...new Set(
    scenarios.flatMap((scenario) =>
      getLanguageVoiceIds(
        scenario?.metadata?.languageVoices ||
          scenario?.scenario_metadata?.languageVoices,
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
