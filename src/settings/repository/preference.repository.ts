import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Preference } from '../entity/preference.entity';
import { PreferenceName } from '../../common/constants/user.constants';
import { PreferenceValue } from '../../common/type/common.type';

@Injectable()
export class PreferenceRepository extends Repository<Preference> {
  constructor(private dataSource: DataSource) {
    super(Preference, dataSource.createEntityManager());
  }

  async createPreference(
    preference: Partial<Preference>,
    entityManager?: EntityManager,
  ): Promise<Preference> {
    const repository = entityManager
      ? entityManager.getRepository(Preference)
      : this;
    return repository.save(preference);
  }

  async findPreference(
    name: PreferenceName,
    relatedId: string,
    relatedEntity: string,
    entityManager?: EntityManager,
  ): Promise<Preference | null> {
    const repository = entityManager
      ? entityManager.getRepository(Preference)
      : this;
    return repository.findOne({
      where: { name, relatedId, relatedEntity },
    });
  }

  async findPreferenceById(
    id: string,
    entityManager?: EntityManager,
  ): Promise<Preference | null> {
    const repository = entityManager
      ? entityManager.getRepository(Preference)
      : this;
    return repository.findOne({
      where: { id },
    });
  }

  async updatePreference(
    id: string,
    value: PreferenceValue,
    entityManager?: EntityManager,
  ): Promise<void> {
    const repository = entityManager
      ? entityManager.getRepository(Preference)
      : this;
    await repository.update(id, { value });
  }

  async deletePreference(
    id: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    const repository = entityManager
      ? entityManager.getRepository(Preference)
      : this;
    await repository.delete(id);
  }
}
