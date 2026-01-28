import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ReferenceDocument } from '../entity/reference-document.entity';

@Injectable()
export class ReferenceDocumentRepository extends Repository<ReferenceDocument> {
  constructor(private readonly dataSource: DataSource) {
    super(ReferenceDocument, dataSource.createEntityManager());
  }

  async getDistinctCategories(
    em?: EntityManager,
  ): Promise<{ category: string; count: number }[]> {
    const repo = em?.getRepository(ReferenceDocument) || this;
    return repo
      .createQueryBuilder('document')
      .select('document.category', 'category')
      .addSelect('COUNT(document.category)', 'count')
      .where('document.category IS NOT NULL')
      .groupBy('document.category')
      .orderBy('count', 'DESC')
      .getRawMany();
  }
}
