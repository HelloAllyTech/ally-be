import { Injectable, NotFoundException } from '@nestjs/common';
import { Languages } from '../entity/languages.entity';
import { LanguagesRepository } from '../repository/languages.repository';
import { UpdateLanguageDto } from '../dto/update-language.dto';
import { CreateLanguagesDto } from '../dto/create-languages.dto';
import { DeepPartial } from 'typeorm';

@Injectable()
export class LanguageService {
  constructor(private readonly languagesRepository: LanguagesRepository) {}

  async createLanguages(
    createLanguagesDto: CreateLanguagesDto,
  ): Promise<Languages[]> {
    // Transform each CreateLanguageDto to Languages entity
    const languagesToCreate = createLanguagesDto.languages.map((langDto) =>
      this.languagesRepository.create(langDto),
    );

    // Save all the created entities
    return this.languagesRepository.save(languagesToCreate);
  }

  async updateLanguage(
    id: number,
    updateLanguageDto: UpdateLanguageDto,
  ): Promise<boolean> {
    const language = await this.languagesRepository.findOne({
      where: { id },
    });

    if (!language) {
      throw new NotFoundException('Language not found');
    }

    const updated = await this.languagesRepository.update(
      id,
      updateLanguageDto as DeepPartial<Languages>,
    );

    return updated.affected !== 0;
  }
}
