import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Preference } from '../entity/preference.entity';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from '../../common/constants/user.constants';

@Injectable()
export class PreferenceRepository extends Repository<Preference> {
  constructor(private dataSource: DataSource) {
    super(Preference, dataSource.createEntityManager());
  }

  async getHiddenChatTypesForTenants(
    tenantIds: string[],
  ): Promise<{ tenantId: string; hiddenChatTypes: string[] }[]> {
    const results = await this.dataSource
      .createQueryBuilder(Preference, 'p')
      .select('p.relatedId', 'tenantId')
      .addSelect('ARRAY_AGG(p.value)', 'hiddenChatTypes')
      .where('p.relatedEntity = :relatedEntity', {
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      })
      .andWhere('p.name = :name', { name: PreferenceName.HIDDEN_CHAT_TYPES })
      .andWhere('p.relatedId IN (:...tenantIds)', { tenantIds })
      .groupBy('p.relatedId')
      .getRawMany();

    return results.map((result) => ({
      tenantId: result.tenantId,
      hiddenChatTypes: result.hiddenChatTypes,
    }));
  }
}
