import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  DocumentUploadStatus,
  ReferenceDocument,
} from '../entity/reference-document.entity';

@Injectable()
export class ReferenceDocumentRepository extends Repository<ReferenceDocument> {
  constructor(private dataSource: DataSource) {
    super(ReferenceDocument, dataSource.createEntityManager());
  }

  async createDocument(
    data: Partial<ReferenceDocument>,
    entityManager?: EntityManager,
  ): Promise<ReferenceDocument> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    const document = repository.create(data);
    return repository.save(document);
  }

  async findPublicSuccessfulDocuments(
    entityManager?: EntityManager,
  ): Promise<Pick<ReferenceDocument, 'id'>[]> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    return repository.find({
      select: ['id'],
      where: {
        isPublic: true,
        isArchived: false,
        uploadStatus: DocumentUploadStatus.SUCCESS,
      },
    });
  }

  async findTenantSuccessfulDocuments(
    organizationId: string,
    entityManager?: EntityManager,
  ): Promise<Pick<ReferenceDocument, 'id'>[]> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    return repository.find({
      select: ['id'],
      where: [
        {
          isPublic: true,
          uploadStatus: DocumentUploadStatus.SUCCESS,
          isArchived: false,
        },
        {
          organizationId,
          uploadStatus: DocumentUploadStatus.SUCCESS,
          isArchived: false,
        },
      ],
    });
  }

  async findById(
    id: string,
    entityManager?: EntityManager,
  ): Promise<ReferenceDocument | null> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    return repository.findOneBy({ id });
  }

  async findPublicById(
    id: string,
    entityManager?: EntityManager,
  ): Promise<ReferenceDocument | null> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    return repository.findOneBy({
      id,
      isPublic: true,
      uploadStatus: DocumentUploadStatus.SUCCESS,
    });
  }

  async findPrivateById(
    id: string,
    organizationId: string,
    entityManager?: EntityManager,
  ): Promise<ReferenceDocument | null> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    return repository.findOneBy({
      id,
      organizationId,
      uploadStatus: DocumentUploadStatus.SUCCESS,
    });
  }

  async updateDocument(
    id: string,
    data: Partial<ReferenceDocument>,
    entityManager?: EntityManager,
  ): Promise<void> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    await repository.update(id, data);
  }

  async deleteDocument(
    id: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    await repository.delete(id);
  }

  async archiveDocument(
    id: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    await this.updateDocument(
      id,
      {
        isArchived: true,
        archivedAt: new Date(),
      },
      entityManager,
    );
  }

  async unarchiveDocument(
    id: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    await this.updateDocument(
      id,
      {
        isArchived: false,
        archivedAt: undefined,
      },
      entityManager,
    );
  }

  async getDistinctCategories(
    entityManager?: EntityManager,
  ): Promise<string[]> {
    const repository = entityManager
      ? entityManager.getRepository(ReferenceDocument)
      : this;
    const categories = await repository
      .createQueryBuilder('document')
      .select('document.category', 'category')
      .addSelect('COUNT(document.category)', 'count')
      .where('document.category IS NOT NULL')
      .groupBy('document.category')
      .orderBy('count', 'DESC')
      .getRawMany();

    return categories.map((cat) => cat.category);
  }
}
