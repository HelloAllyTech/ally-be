import { Injectable } from '@nestjs/common';
import { Languages } from '../entity/languages.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import { DEFAULT_LANGUAGE_CODE } from '../constants/language.constant';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from 'src/learn/constants/scenario-session.constants';
import { ELIGBLE_APP_LANGUAGES } from 'src/common/constants/translation.constants';

@Injectable()
export class SharedLanguageService {
  constructor(private readonly languagesRepository: LanguagesRepository) {}

  /**
   * The active language rows the app supports for translation
   * (`ELIGBLE_APP_LANGUAGES`, currently hi/mr/ta/kn). English is naturally
   * excluded since it is not an eligible *target*.
   */
  getEligibleAppLanguages(): Promise<Languages[]> {
    return this.languagesRepository.getByTranslationCodes(
      ELIGBLE_APP_LANGUAGES,
    );
  }

  /**
   * Get languages by their IDs
   * @param ids Array of language IDs to fetch
   * @returns Promise with array of languages
   */
  async getLanguagesByIds(ids: number[]): Promise<Languages[]> {
    return this.languagesRepository.getLanguagesById(ids);
  }

  async getValidLanguages(languageIds: number[]) {
    let languages = await this.getLanguagesByIds([...languageIds]);

    languages = languages.filter(
      (language) => !language.value.includes(DEFAULT_LANGUAGE_CODE),
    );
    const languagesMap: Record<string, (typeof languages)[number]> = {};

    languages.forEach((language) => {
      languagesMap[language.translationCode] = language;
    });

    return {
      languages,
      languagesMap,
    };
  }

  async getLanguageByLanguageCode(
    languageCode: string,
  ): Promise<Languages | null> {
    return this.languagesRepository.getLanguageByLanguageCode(languageCode);
  }

  async getLanguageByValue(value: string): Promise<Languages | null> {
    return this.languagesRepository.getLanguageByValue(value);
  }

  /**
   * Resolve a language id (as stored in `scenario_sessions.metadata.languageId`)
   * to its `value` (e.g. 'ta-IN'), regardless of `active` status — matching the
   * `LEFT JOIN languages l ON l.id = ...` convention used by the analytics/drift
   * read paths, which don't filter on `active` either. Returns 'en' when the id
   * is missing or unresolvable (deleted/misconfigured row).
   */
  async getLanguageValueById(
    languageId: number | null | undefined,
  ): Promise<string> {
    if (!languageId) return DEFAULT_LANGUAGE_CODE;
    const language = await this.languagesRepository.findOneBy({
      id: languageId,
    });
    return language?.value ?? DEFAULT_LANGUAGE_CODE;
  }

  async getValidLanguageCodes(languageIds: number[]) {
    const { languages } = await this.getValidLanguages(languageIds);

    if (!languages || languages.length === 0) {
      return;
    }

    const languagesFiltered = (languages ?? []).filter(
      (l: any) =>
        l &&
        l.translationCode &&
        l.translationCode.trim() !== '' &&
        l.translationCode !== DEFAULT_LANGUAGE_TRANSLATION_CODE,
    );

    return languagesFiltered.map((l: any) => l.translationCode);
  }
}
