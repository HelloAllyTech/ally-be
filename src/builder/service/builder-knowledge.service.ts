import { Injectable } from '@nestjs/common';
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
import { BuilderLessonCategory } from '../enum/builder.enum';
import { BUILDER_LESSONS_IN_CONTEXT } from '../constants/builder.constants';
import { BUILDER_REPOS } from '../constants/builder-repos.constants';

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
  async buildContextBlock(repos?: string[]): Promise<string> {
    const [maps, lessons] = await Promise.all([
      this.repoMapRepository.listAll(),
      this.lessonRepository.listRecent(BUILDER_LESSONS_IN_CONTEXT, repos),
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
      for (const lesson of lessons) {
        parts.push(
          `- [${lesson.category}${lesson.repo ? `/${lesson.repo}` : ''}] ${lesson.lesson}`,
        );
      }
    }

    return parts.join('\n');
  }

  /** Feature-toggle keys, for validating what a PRD proposes to gate on. */
  listFeatureToggleKeys(): FeatureToggleKey[] {
    return FEATURE_TOGGLES.map((toggle) => toggle.key);
  }

  async recordLesson(params: {
    sessionId?: string | null;
    repo?: string | null;
    category: BuilderLessonCategory;
    lesson: string;
    createdBy?: number;
  }): Promise<void> {
    const text = params.lesson?.trim();
    if (!text) return;
    await this.lessonRepository.save(
      this.lessonRepository.create({
        sessionId: params.sessionId ?? null,
        repo: params.repo ?? null,
        category: params.category,
        lesson: text,
        createdBy: params.createdBy,
      }),
    );
  }

  /**
   * Lesson text only, for embedding in the build prompt. The build prompt is
   * shell-and-markdown rather than a structured context block, so it wants
   * sentences rather than rows.
   */
  async listLessonTexts(limit: number, repos?: string[]): Promise<string[]> {
    const lessons = await this.lessonRepository.listRecent(limit, repos);
    return lessons.map(
      (lesson) =>
        `[${lesson.category}${lesson.repo ? `/${lesson.repo}` : ''}] ${lesson.lesson}`,
    );
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
