import { DataSource, In, Repository } from 'typeorm';
import { Languages } from '../entity/languages.entity';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LanguagesRepository extends Repository<Languages> {
  constructor(private dataSource: DataSource) {
    super(Languages, dataSource.createEntityManager());
  }

  getLanguagesById(ids: number[]): Promise<Languages[]> {
    return this.find({
      select: ['id', 'value', 'label', 'translationCode'],
      where: { id: In(ids) },
    });
  }

  async createLanguage(languageData: Partial<Languages>): Promise<Languages> {
    const language = this.create(languageData);
    return this.save(language);
  }

  async updateLanguage(
    id: number,
    updateData: Partial<Languages>,
  ): Promise<Languages | null> {
    await this.update(id, { ...updateData, updatedAt: new Date() });
    return this.findOne({ where: { id } });
  }
}
