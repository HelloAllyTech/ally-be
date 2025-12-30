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
      where: { id: In(ids), active: true },
    });
  }

  getLanguageByLanguageCode(languageCode: string): Promise<Languages | null> {
    return this.findOne({ where: { value: languageCode } });
  }
}
