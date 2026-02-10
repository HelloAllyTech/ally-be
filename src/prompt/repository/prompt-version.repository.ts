import { DataSource, Repository } from 'typeorm';
import { PromptVersion } from '../entity/prompt-version.entity';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PromptVersionRepository extends Repository<PromptVersion> {
  constructor(private dataSource: DataSource) {
    super(PromptVersion, dataSource.createEntityManager());
  }

  getLatestPromptVersion(promptId: string): Promise<PromptVersion | null> {
    return this.createQueryBuilder('promptVersion')
      .where('promptVersion.promptId = :promptId', { promptId })
      .orderBy('promptVersion.version', 'DESC')
      .limit(1)
      .getOne();
  }

  async deleteVersionsBefore(
    promptId: string,
    minVersionToKeep: number,
  ): Promise<void> {
    await this.createQueryBuilder()
      .delete()
      .from(PromptVersion)
      .where('promptId = :promptId', { promptId })
      .andWhere('version < :minVersionToKeep', { minVersionToKeep })
      .execute();
  }
}
