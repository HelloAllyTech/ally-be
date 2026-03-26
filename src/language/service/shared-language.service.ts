import { Injectable } from '@nestjs/common';
import { Languages } from '../entity/languages.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import { DEFAULT_LANGUAGE_CODE } from '../constants/language.constant';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from 'src/learn/constants/scenario-session.constants';

@Injectable()
export class SharedLanguageService {
  constructor(private readonly languagesRepository: LanguagesRepository) {}

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
