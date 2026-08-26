import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Repository } from 'typeorm';
import { BuilderRepoMap } from '../entity/builder-repo-map.entity';
import { BuilderLesson } from '../entity/builder-lesson.entity';

@Injectable()
export class BuilderRepoMapRepository extends Repository<BuilderRepoMap> {
  constructor(dataSource: DataSource) {
    super(BuilderRepoMap, dataSource.createEntityManager());
  }

  findByRepo(repo: string): Promise<BuilderRepoMap | null> {
    return this.findOne({ where: { repo } });
  }

  listAll(): Promise<BuilderRepoMap[]> {
    return this.find({ order: { repo: 'ASC' } });
  }
}

@Injectable()
export class BuilderLessonRepository extends Repository<BuilderLesson> {
  constructor(dataSource: DataSource) {
    super(BuilderLesson, dataSource.createEntityManager());
  }

  /**
   * The most recent lessons, newest first. Platform-wide lessons (repo NULL)
   * are always in scope; repo-specific ones only when that repo is in play,
   * so an ally-mobile gotcha doesn't take up room in a backend build.
   */
  async listRecent(limit: number, repos?: string[]): Promise<BuilderLesson[]> {
    const query = this.createQueryBuilder('lesson')
      .orderBy('lesson.createdAt', 'DESC')
      .limit(limit);

    if (repos?.length) {
      query
        .where('lesson.repo IS NULL')
        .orWhere('lesson.repo IN (:...repos)', { repos });
      return query.getMany();
    }
    return this.find({
      where: { repo: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
