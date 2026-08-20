import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  GlossaryInjectionMode,
  GlossarySectionStatus,
  LanguageGlossarySection,
} from '../entity/language-glossary-section.entity';

/**
 * Global rows have profileId NULL; overlay rows carry the variety-profile id.
 * Reads that serve ONE audience (runtime, cap checks) take an optional
 * profileId and return the merged view — global plus that profile's overlays,
 * overlay winning on sectionCode. Reads that serve the admin/consolidation
 * (findAllForLanguage) return every row, global and overlay alike.
 */
@Injectable()
export class LanguageGlossaryRepository extends Repository<LanguageGlossarySection> {
  constructor(private dataSource: DataSource) {
    super(LanguageGlossarySection, dataSource.createEntityManager());
  }

  /** All sections for a language — global AND overlay rows, stable order. */
  findAllForLanguage(languageId: number): Promise<LanguageGlossarySection[]> {
    return this.find({
      where: { languageId, organizationId: IsNull() },
      order: { sectionCode: 'ASC', profileId: 'ASC' },
    });
  }

  /**
   * Sections runtime serves: `published`, optionally filtered by tier, merged
   * for the given profile (global + overlays, overlay wins on sectionCode).
   * Without a profileId this is the global view — existing behavior.
   */
  async findPublishedByLanguage(
    languageId: number,
    injectionMode?: GlossaryInjectionMode,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection[]> {
    const rows = await this.find({
      where: {
        languageId,
        organizationId: IsNull(),
        status: GlossarySectionStatus.PUBLISHED,
        ...(injectionMode ? { injectionMode } : {}),
      },
      order: { sectionCode: 'ASC' },
    });
    const merged = new Map<string, LanguageGlossarySection>();
    for (const row of rows) {
      if (!row.profileId) merged.set(row.sectionCode, row);
    }
    if (profileId) {
      for (const row of rows) {
        if (row.profileId === profileId) merged.set(row.sectionCode, row);
      }
    }
    return [...merged.values()].sort((a, b) =>
      a.sectionCode.localeCompare(b.sectionCode),
    );
  }

  /** One section row: global when profileId is absent/null, else the overlay. */
  findSection(
    languageId: number,
    sectionCode: string,
    profileId?: string | null,
  ): Promise<LanguageGlossarySection | null> {
    return this.findOne({
      where: {
        languageId,
        sectionCode,
        organizationId: IsNull(),
        profileId: profileId ? profileId : IsNull(),
      },
    });
  }
}
