import { Injectable } from '@nestjs/common';
import { Languages } from '../entity/languages.entity';
import { LanguagesRepository } from '../repository/languages.repository';

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
    let languages = await this.getLanguagesByIds([...languageIds, 2]);

    languages = languages.filter((language) => !language.value.includes('en'));
    const languagesMap: Record<string, (typeof languages)[number]> = {};

    languages.forEach((language) => {
      languagesMap[language.translationCode] = language;
    });

    return {
      languages,
      languagesMap,
    };
  }
}
