import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { BuilderRepoMap } from '../entity/builder-repo-map.entity';
import { BuilderLesson } from '../entity/builder-lesson.entity';
import { BuilderExemplar } from '../entity/builder-exemplar.entity';
import {
  BuilderExemplarOutcome,
  BuilderLessonStatus,
} from '../enum/builder.enum';

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

  listByStatus(status: BuilderLessonStatus): Promise<BuilderLesson[]> {
    return this.find({ where: { status }, order: { createdAt: 'ASC' } });
  }

  /**
   * The curated set a prompt may draw on, scoped to the repos in play.
   *
   * Returns the whole eligible set rather than a page of it, which is only
   * reasonable because the curator caps the active set — that cap is what
   * lets retrieval skip an index and hand the lot to a re-rank instead.
   * Platform-wide lessons (no repos) are always in scope; repo-specific ones
   * only when that repo is in play, so an ally-mobile gotcha does not take up
   * room in a backend build.
   */
  async listActiveForRepos(repos?: string[]): Promise<BuilderLesson[]> {
    const query = this.createQueryBuilder('lesson')
      .where('lesson.status = :status', {
        status: BuilderLessonStatus.ACTIVE,
      })
      // Pinned first, then the strongest evidence: agreement across builds and
      // times a run said this changed what it did, less contradictions.
      .orderBy('lesson.pinned', 'DESC')
      .addOrderBy(
        'lesson."sourceCount" + lesson."timesApplied" - 2 * lesson."timesContradicted"',
        'DESC',
      )
      .addOrderBy('lesson.createdAt', 'DESC');

    if (repos?.length) {
      query.andWhere(
        `(lesson.repos IS NULL
           OR jsonb_array_length(lesson.repos) = 0
           OR lesson.repos ?| ARRAY[:...repos])`,
        { repos },
      );
    } else {
      query.andWhere(
        '(lesson.repos IS NULL OR jsonb_array_length(lesson.repos) = 0)',
      );
    }
    return query.getMany();
  }

  /**
   * Count a lesson as having been used, or as having failed to prevent the
   * thing it warns about. This is what makes the curator's retirement
   * decisions evidence rather than taste.
   */
  async recordApplied(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.createQueryBuilder()
      .update()
      .set({
        timesApplied: () => '"timesApplied" + 1',
        lastAppliedAt: new Date(),
      })
      .whereInIds(ids)
      .execute();
  }

  async recordContradicted(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.createQueryBuilder()
      .update()
      .set({ timesContradicted: () => '"timesContradicted" + 1' })
      .whereInIds(ids)
      .execute();
  }

  /**
   * The most recent lessons, newest first. Platform-wide lessons (repo NULL)
   * are always in scope; repo-specific ones only when that repo is in play,
   * so an ally-mobile gotcha doesn't take up room in a backend build.
   *
   * @deprecated Recency-only; `listActiveForRepos` is scored and respects
   * curation. Kept for the pre-curation callers until they are all moved.
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

@Injectable()
export class BuilderExemplarRepository extends Repository<BuilderExemplar> {
  constructor(dataSource: DataSource) {
    super(BuilderExemplar, dataSource.createEntityManager());
  }

  findBySession(sessionId: string): Promise<BuilderExemplar | null> {
    return this.findOne({ where: { sessionId } });
  }

  /**
   * Recent archived builds, as candidates for a re-rank.
   *
   * Deliberately not filtered to successes: "a similar build tried this and
   * the PR was closed unmerged" is more useful to the next attempt than any
   * number of wins, and a corpus of only successes would be flattering and
   * useless.
   */
  listCandidates(limit: number, repos?: string[]): Promise<BuilderExemplar[]> {
    const query = this.createQueryBuilder('exemplar')
      .orderBy('exemplar.createdAt', 'DESC')
      .limit(limit);
    if (repos?.length) {
      query.where('exemplar.repos ?| ARRAY[:...repos]', { repos });
    }
    return query.getMany();
  }

  /** The frozen selection for a session, in a stable order. */
  async findByIds(ids: string[]): Promise<BuilderExemplar[]> {
    if (!ids.length) return [];
    const rows = await this.find({ where: { id: In(ids) } });
    // Restore the ranked order the ids were stored in — the DB returns them
    // in whatever order it likes, and the first exemplar is the most relevant.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as BuilderExemplar[];
  }

  /** Exemplars whose outcome may still change. */
  listUnsettled(): Promise<BuilderExemplar[]> {
    return this.find({
      where: [
        { outcome: BuilderExemplarOutcome.OPEN },
        { outcome: BuilderExemplarOutcome.PARTIALLY_MERGED },
      ],
      order: { createdAt: 'ASC' },
    });
  }
}
