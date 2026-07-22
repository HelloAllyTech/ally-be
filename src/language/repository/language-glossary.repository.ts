import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';

@Injectable()
export class LanguageGlossaryRepository extends Repository<LanguageGlossarySection> {
  constructor(private dataSource: DataSource) {
    super(LanguageGlossarySection, dataSource.createEntityManager());
  }

  /** All sections for a language (global rows only in v1), stable order. */
  findAllForLanguage(languageId: number): Promise<LanguageGlossarySection[]> {
    return this.find({
      where: { languageId, organizationId: IsNull() },
      order: { sectionCode: 'ASC' },
    });
  }

  /** Sections runtime serves: `published`, optionally filtered by tier. */
  findPublishedByLanguage(
    languageId: number,
    injectionMode?: GlossaryInjectionMode,
  ): Promise<LanguageGlossarySection[]> {
    return this.find({
      where: {
        languageId,
        organizationId: IsNull(),
        status: GlossarySectionStatus.PUBLISHED,
        ...(injectionMode ? { injectionMode } : {}),
      },
      order: { sectionCode: 'ASC' },
    });
  }

  findSection(
    languageId: number,
    sectionCode: string,
  ): Promise<LanguageGlossarySection | null> {
    return this.findOne({
      where: { languageId, sectionCode, organizationId: IsNull() },
    });
  }
}
