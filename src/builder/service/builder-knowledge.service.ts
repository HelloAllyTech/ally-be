import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
} from 'src/authorization/constants/admin-feature-toggle.constants';
import { BuilderRepoMap } from '../entity/builder-repo-map.entity';
import {
  BuilderLessonRepository,
  BuilderRepoMapRepository,
} from '../repository/builder-knowledge.repository';
import { BuilderLesson } from '../entity/builder-lesson.entity';
import {
  BuilderLessonCategory,
  BuilderLessonStatus,
} from '../enum/builder.enum';
import { BUILDER_LESSONS_IN_CONTEXT } from '../constants/builder.constants';
import { BUILDER_REPOS } from '../constants/builder-repos.constants';

/**
 * One rendered lesson line.
 *
 * Carries a short id because runs are asked to report which lessons actually
 * changed what they did (`appliedLessonIds`), and that is what lets the curator
 * retire the ones nobody uses. Short rather than the full uuid: it only has to
 * be unambiguous within one prompt, and a 36-character id per line is a real
 * cost across twenty of them.
 */
export const renderLessonLine = (lesson: BuilderLesson): string => {
  const scope = lesson.repos?.length
    ? `/${lesson.repos.join(',')}`
    : lesson.repo
      ? `/${lesson.repo}`
      : '';
  const seen = lesson.sourceCount > 1 ? ` (seen ${lesson.sourceCount}×)` : '';
  return `- [${lesson.id}] [${lesson.category}${scope}]${seen} ${lesson.lesson}`;
};

/**
 * The agent's standing knowledge of Ally: Repo Knowledge Packs, the feature
 * registry, and lessons carried over from previous builds.
 *
 * This is the cheap half of "codebase-aware". The maps and lessons are
 * assembled once per turn into a stable prefix that Anthropic prompt-caching
 * can hold, so a twenty-turn interview pays full price for this context once
 * rather than twenty times. Live GitHub reads are the expensive half and are
 * reserved for following up on what the maps point at.
 */
@Injectable()
export class BuilderKnowledgeService {
  private readonly logger = LoggerService.getInstance(
    BuilderKnowledgeService.name,
  );

  constructor(
    private readonly repoMapRepository: BuilderRepoMapRepository,
    private readonly lessonRepository: BuilderLessonRepository,
  ) {}

  /**
   * The cacheable context block: what each repo is, what we know about its
   * insides, and what previous builds learned.
   *
   * Returns markdown rather than JSON because it is read by a model, not
   * parsed — and because a map is prose to begin with.
   */
  async buildContextBlock(
    repos?: string[],
    /**
     * Digests of similar past builds. Passed in rather than fetched here so
     * the caller controls when a re-rank call is worth making — this block is
     * assembled on every turn, and the exemplar set changes far more slowly
     * than that.
     */
    exemplars: string[] = [],
  ): Promise<string> {
    const [maps, lessons] = await Promise.all([
      this.repoMapRepository.listAll(),
      this.selectLessons(repos),
    ]);

    const parts: string[] = [];

    parts.push('# Ally platform — repositories\n');
    for (const repo of BUILDER_REPOS) {
      parts.push(`- **${repo.repo}** — ${repo.description}`);
    }

    const mapsByRepo = new Map(maps.map((map) => [map.repo, map]));
    const relevantMaps = repos?.length
      ? repos.map((repo) => mapsByRepo.get(repo)).filter(Boolean)
      : maps;

    if (relevantMaps.length) {
      parts.push('\n# Repo knowledge packs\n');
      for (const map of relevantMaps as BuilderRepoMap[]) {
        parts.push(
          `\n## ${map.repo}${
            map.commitSha ? ` (at ${map.commitSha.slice(0, 7)})` : ''
          }\n\n${map.mapMd}`,
        );
      }
    } else {
      // Say it plainly rather than letting the agent infer the repos are
      // empty: no map means "look it up", not "there is nothing there".
      parts.push(
        '\n# Repo knowledge packs\n\nNone generated yet. Use the github_* tools to ' +
          'explore before making claims about how anything is built.',
      );
    }

    parts.push('\n# Platform feature registry\n');
    parts.push(
      'Admin surfaces are gated by these feature-toggle keys (a new admin ' +
        'surface needs one):\n',
    );
    for (const toggle of FEATURE_TOGGLES) {
      parts.push(
        `- \`${toggle.key}\` — ${toggle.label}: ${toggle.description}`,
      );
    }

    if (lessons.length) {
      parts.push('\n# Lessons from previous builds\n');
      parts.push(
        'Each carries an id. If one of these changes what you do, cite its id ' +
          'in your report — an unused lesson is one nobody should keep paying ' +
          'context for.\n',
      );
      for (const lesson of lessons) {
        parts.push(renderLessonLine(lesson));
      }
    }

    if (exemplars.length) {
      parts.push('\n# Similar builds this platform has already attempted\n');
      parts.push(
        'What happened *after* each shipped is the useful part — a rejected ' +
          'approach is worth more here than a successful one.\n',
      );
      for (const exemplar of exemplars) {
        parts.push(`\n${exemplar}`);
      }
    }

    return parts.join('\n');
  }

  /** Feature-toggle keys, for validating what a PRD proposes to gate on. */
  listFeatureToggleKeys(): FeatureToggleKey[] {
    return FEATURE_TOGGLES.map((toggle) => toggle.key);
  }

  /**
   * Record a lesson as a **candidate**, for the curator to place.
   *
   * Candidates are not fed to prompts. That is the whole change: raw
   * retrospective bullets used to go straight into the set every future run
   * read, so the same trap learned five times became five rows competing for
   * one fixed context budget.
   */
  /**
   * Just the repo knowledge packs, for the build phases.
   *
   * The interview has had these since the module was written; the planner and
   * coder never did, so every build phase rediscovered repo structure by
   * reading files. On the first real build the planner spent $7.85 and 19
   * minutes largely doing that.
   *
   * Rendered separately from `buildContextBlock` rather than reusing it because
   * the build phases have no use for the feature-toggle registry that block
   * also carries, and a prompt prefix is not the place for tokens nobody reads.
   */
  async renderRepoPacks(repos?: string[]): Promise<string> {
    const maps = await this.repoMapRepository.listAll();
    const byRepo = new Map(maps.map((map) => [map.repo, map]));
    const relevant = (
      repos?.length
        ? repos.map((repo) => byRepo.get(repo)).filter(Boolean)
        : maps
    ) as BuilderRepoMap[];

    if (!relevant.length) return '';

    const parts = ['# Repo knowledge packs\n'];
    for (const map of relevant) {
      parts.push(
        `\n## ${map.repo}${
          map.commitSha ? ` (at ${map.commitSha.slice(0, 7)})` : ''
        }\n\n${map.mapMd}`,
      );
    }
    return parts.join('\n');
  }

  async recordLesson(params: {
    sessionId?: string | null;
    /** @deprecated pass `repos` — a single repo loses multi-repo attribution. */
    repo?: string | null;
    repos?: string[] | null;
    category: BuilderLessonCategory;
    lesson: string;
    createdBy?: number;
  }): Promise<void> {
    const text = params.lesson?.trim();
    if (!text) return;

    // A two-repo build used to lose its attribution entirely and become
    // platform-wide, because only a single-repo build had a `repo` to record.
    const repos = params.repos?.length
      ? params.repos
      : params.repo
        ? [params.repo]
        : null;

    await this.lessonRepository.save(
      this.lessonRepository.create({
        sessionId: params.sessionId ?? null,
        repo: repos?.length === 1 ? repos[0] : null,
        repos,
        category: params.category,
        lesson: text,
        status: BuilderLessonStatus.CANDIDATE,
        sourceSessionIds: params.sessionId ? [params.sessionId] : null,
        createdBy: params.createdBy,
      }),
    );
  }

  /**
   * The lessons a prompt should carry, from the curated set.
   *
   * Scored rather than recent: `listRecent` meant that after twenty builds the
   * earliest lessons were unreachable however good they were, and a lesson
   * five builds independently confirmed ranked below one written yesterday.
   * The curator's cap is what makes this a plain query — the whole eligible
   * set is already small enough to rank in SQL.
   */
  async selectLessons(repos?: string[]): Promise<BuilderLesson[]> {
    const active = await this.lessonRepository.listActiveForRepos(repos);
    if (active.length) return active.slice(0, BUILDER_LESSONS_IN_CONTEXT);

    // Nothing curated yet (a fresh deployment, or the curator has not run).
    // Fall back to recency so early builds still learn from each other.
    return this.lessonRepository.listRecent(BUILDER_LESSONS_IN_CONTEXT, repos);
  }

  /**
   * Lesson text only, for embedding in the build prompt. The build prompt is
   * shell-and-markdown rather than a structured context block, so it wants
   * sentences rather than rows.
   */
  async listLessonTexts(limit: number, repos?: string[]): Promise<string[]> {
    const lessons = await this.selectLessons(repos);
    return lessons
      .slice(0, limit)
      .map((lesson) => renderLessonLine(lesson).replace(/^- /, ''));
  }

  /**
   * The lesson library for the curation UI, newest-strongest first.
   *
   * Defaults to the active set, because that is what runs actually read —
   * showing candidates and retired rows by default would make the list look
   * like the memory and it is not.
   */
  listLessons(filter: {
    status?: BuilderLessonStatus;
    category?: BuilderLessonCategory;
    repo?: string;
  }): Promise<BuilderLesson[]> {
    const query = this.lessonRepository
      .createQueryBuilder('lesson')
      .where('lesson.status = :status', {
        status: filter.status ?? BuilderLessonStatus.ACTIVE,
      })
      .orderBy('lesson.pinned', 'DESC')
      .addOrderBy(
        'lesson."sourceCount" + lesson."timesApplied" - 2 * lesson."timesContradicted"',
        'DESC',
      )
      .addOrderBy('lesson.createdAt', 'DESC');

    if (filter.category) {
      query.andWhere('lesson.category = :category', {
        category: filter.category,
      });
    }
    if (filter.repo) {
      query.andWhere('(lesson.repos ? :repo OR lesson.repo = :repo)', {
        repo: filter.repo,
      });
    }
    return query.getMany();
  }

  /**
   * A human's edit to the library.
   *
   * Pinning is the important one: it takes the lesson out of the curator's
   * reach entirely. A person who has decided a rule matters outranks a model's
   * tidying pass, and without an escape hatch the consolidation pass would be
   * something to distrust rather than rely on.
   */
  async updateLesson(
    lessonId: string,
    changes: {
      lesson?: string;
      category?: BuilderLessonCategory;
      status?: BuilderLessonStatus;
      pinned?: boolean;
      tags?: string[];
    },
    userId: number,
  ): Promise<BuilderLesson> {
    const existing = await this.lessonRepository.findOne({
      where: { id: lessonId },
    });
    if (!existing) {
      throw new NotFoundException(`Builder lesson not found: ${lessonId}`);
    }

    await this.lessonRepository.update(
      { id: lessonId },
      {
        ...(changes.lesson !== undefined
          ? { lesson: changes.lesson.trim() }
          : {}),
        ...(changes.category !== undefined
          ? { category: changes.category }
          : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.pinned !== undefined ? { pinned: changes.pinned } : {}),
        ...(changes.tags !== undefined ? { tags: changes.tags } : {}),
      },
    );
    this.logger.info(
      `Builder lesson ${lessonId} edited by user ${userId}${
        changes.pinned === true ? ' (pinned)' : ''
      }${changes.status ? ` (→ ${changes.status})` : ''}`,
    );
    return this.lessonRepository.findOneOrFail({ where: { id: lessonId } });
  }

  /** Repo maps with their staleness, for the settings view. */
  listRepoMaps(): Promise<BuilderRepoMap[]> {
    return this.repoMapRepository.listAll();
  }

  /** Upsert from the context-refresh workflow — one row per repo. */
  async upsertRepoMap(params: {
    repo: string;
    mapMd: string;
    commitSha?: string | null;
    stats?: Record<string, any> | null;
  }): Promise<BuilderRepoMap> {
    const existing = await this.repoMapRepository.findByRepo(params.repo);
    const payload = {
      repo: params.repo,
      mapMd: params.mapMd,
      commitSha: params.commitSha ?? null,
      stats: params.stats ?? null,
      generatedAt: new Date(),
    };
    if (existing) {
      await this.repoMapRepository.update({ id: existing.id }, payload);
      return this.repoMapRepository.findOneOrFail({
        where: { id: existing.id },
      });
    }
    return this.repoMapRepository.save(this.repoMapRepository.create(payload));
  }
}
