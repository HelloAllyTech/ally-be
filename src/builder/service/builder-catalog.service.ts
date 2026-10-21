import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AI_TASK_REGISTRY } from 'src/llm/constants/ai-task-registry.constants';
import { CONNECTED_SKILLS } from 'src/skill-experiment/constants/skill-experiment.constants';
import {
  BUILDER_CAPABILITIES,
  BUILDER_CAPABILITY_EXEMPT_MODULES,
  BuilderCapability,
} from '../constants/builder-capabilities.constants';
import {
  BuilderCatalogEntry,
  BuilderRepoCatalog,
} from '../entity/builder-repo-catalog.entity';
import { BuilderRepoCatalogRepository } from '../repository/builder-knowledge.repository';

/** How long the catalog rows are reused in memory. They change once a week. */
const CATALOG_TTL_MS = 10 * 60_000;

/** Results a single lookup returns, so one broad query cannot fill a turn. */
const LOOKUP_LIMIT = 15;

/**
 * Component names shared by web and mobile that say nothing about a learner
 * surface — UI primitives both apps happen to have. Matched on the normalised
 * name (lowercase, letters and digits only).
 */
const GENERIC_COMPONENT_NAMES = new Set([
  'button',
  'buttongroup',
  'carousel',
  'chip',
  'circularprogress',
  'custommarkdown',
  'dropdown',
  'emojipicker',
  'emptystate',
  'errorboundary',
  'search',
  'shinytext',
  'starrating',
  'timer',
]);

/** The web app learners use, as opposed to the admin console. */
const LEARNER_WEB_APP = 'ally-helpline-dashboard';

export interface BuilderCatalogHit {
  /** capability | ai_task | connected_skill | module | table | route | screen | component | doc … */
  kind: string;
  repo: string;
  name: string;
  path?: string;
  detail?: string;
}

export interface BuilderParityTwin {
  name: string;
  web: string;
  mobile: string;
}

const normaliseName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Lowercase words of three or more characters, plus every two-word phrase. */
function queryTerms(query: string): { words: string[]; text: string } {
  const text = query.toLowerCase();
  const words = text
    .split(/[^a-z0-9/]+/)
    .filter((word) => word.length >= 3 || word === 'ab' || word === 'a/b');
  return { words: [...new Set(words)], text };
}

function scoreText(haystack: string, words: string[]): number {
  const lower = haystack.toLowerCase();
  return words.reduce(
    (score, word) => (lower.includes(word) ? score + 1 : score),
    0,
  );
}

/**
 * The platform as a list of things a feature could reuse.
 *
 * Three sources, merged at read time:
 *
 * - the generated catalogs (`builder_repo_catalogs`), one per repo, written by
 *   the context-refresh workflow from `extract-catalog.mjs`;
 * - ally-be's own registries — the AI task registry and Auto-improve's
 *   connected skills — imported directly, because this process already holds
 *   the compiled truth and a copy would only be able to drift;
 * - the hand-written capability lines, which say what each system is FOR.
 *
 * The interview reads a compact rendering of the hand-written part in its
 * cached context, and reaches the rest through `capability_lookup` and
 * `ai_tasks_lookup`. Nothing here calls a model, so it is the same every time.
 */
@Injectable()
export class BuilderCatalogService {
  private readonly logger = LoggerService.getInstance(
    BuilderCatalogService.name,
  );

  private cache: { rows: BuilderRepoCatalog[]; expiresAt: number } | null =
    null;

  constructor(
    private readonly catalogRepository: BuilderRepoCatalogRepository,
  ) {}

  async upsert(params: {
    repo: string;
    commitSha?: string | null;
    entries: BuilderCatalogEntry[];
    stats?: Record<string, any> | null;
  }): Promise<BuilderRepoCatalog> {
    const payload = {
      repo: params.repo,
      commitSha: params.commitSha ?? null,
      entries: params.entries,
      stats: params.stats ?? null,
      generatedAt: new Date(),
    };
    const existing = await this.catalogRepository.findByRepo(params.repo);
    this.cache = null;
    if (existing) {
      await this.catalogRepository.update({ id: existing.id }, payload as any);
      return this.catalogRepository.findOneOrFail({
        where: { id: existing.id },
      });
    }
    return this.catalogRepository.save(this.catalogRepository.create(payload));
  }

  /** Every repo's catalog. Fails soft to none: no catalog means "look it up", not "nothing exists". */
  async listCatalogs(): Promise<BuilderRepoCatalog[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rows;
    try {
      const rows = await this.catalogRepository.listAll();
      this.cache = { rows, expiresAt: Date.now() + CATALOG_TTL_MS };
      return rows;
    } catch (error) {
      this.logger.warn(
        `Builder catalog unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  capabilities(): BuilderCapability[] {
    return BUILDER_CAPABILITIES;
  }

  /**
   * What a request's words point at, best match first.
   *
   * Capabilities score highest, because they are the answer to "is there
   * already something for this?" — a module name is only a place to look. A
   * capability matches on its keywords as phrases inside the query (so "a/b
   * test the debrief prompt" finds Auto-improve) and on single words in its
   * name and purpose.
   */
  async search(
    query: string,
    limit = LOOKUP_LIMIT,
  ): Promise<BuilderCatalogHit[]> {
    const { words, text } = queryTerms(query);
    if (!words.length) return [];
    const scored: { hit: BuilderCatalogHit; score: number }[] = [];

    for (const capability of BUILDER_CAPABILITIES) {
      const phrase = capability.keywords.filter((keyword) =>
        text.includes(keyword.toLowerCase()),
      ).length;
      const loose = scoreText(
        `${capability.name} ${capability.whatItIs} ${capability.reuseWhen} ${capability.keywords.join(' ')}`,
        words,
      );
      const score = phrase * 4 + loose;
      if (score > 0) {
        scored.push({
          score: score + 3,
          hit: {
            kind: 'capability',
            repo: capability.modules[0]?.split(':')[0] ?? 'ally-be',
            name: capability.name,
            path: capability.modules.join(', '),
            detail: `${capability.whatItIs} Reuse when: ${capability.reuseWhen}${
              capability.docs?.length
                ? ` Docs: ${capability.docs.join(', ')}.`
                : ''
            }${capability.adminRoute ? ` Admin: ${capability.adminRoute}.` : ''}`,
          },
        });
      }
    }

    for (const hit of this.aiTaskHits(words)) {
      scored.push({ score: hit.score + 1, hit: hit.hit });
    }

    for (const row of await this.listCatalogs()) {
      for (const entry of row.entries ?? []) {
        const score =
          scoreText(entry.name, words) * 2 +
          scoreText(entry.path ?? '', words) +
          scoreText(entry.detail ?? '', words);
        if (score > 0) {
          scored.push({
            score,
            hit: {
              kind: entry.kind,
              repo: row.repo,
              name: entry.name,
              path: entry.path,
              ...(entry.detail ? { detail: entry.detail } : {}),
            },
          });
        }
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ hit }) => hit);
  }

  /** Model calls and Auto-improve's connected skills matching the words. */
  aiTasksLookup(query: string, limit = LOOKUP_LIMIT): BuilderCatalogHit[] {
    const { words } = queryTerms(query);
    if (!words.length) return [];
    return this.aiTaskHits(words)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ hit }) => hit);
  }

  private aiTaskHits(
    words: string[],
  ): { hit: BuilderCatalogHit; score: number }[] {
    const hits: { hit: BuilderCatalogHit; score: number }[] = [];
    for (const row of AI_TASK_REGISTRY) {
      const score = scoreText(
        `${row.id} ${row.task ?? ''} ${row.trigger} ${row.detail ?? ''} ${row.promptOverride ?? ''}`,
        words,
      );
      if (score > 0) {
        hits.push({
          score,
          hit: {
            kind: 'ai_task',
            repo: String(row.runtime),
            name: row.id,
            detail: `${row.trigger}${row.detail ? ` — ${row.detail}` : ''}. Default model ${
              row.defaultModel
            } (${row.provider}).${row.promptOverride ? ` Prompt: ${row.promptOverride}.` : ''}`,
          },
        });
      }
    }
    for (const [code, skill] of Object.entries(CONNECTED_SKILLS)) {
      const score = scoreText(`${code} ${skill.outputDescription}`, words);
      if (score > 0) {
        hits.push({
          score: score + 1,
          hit: {
            kind: 'connected_skill',
            repo: 'ally-be',
            name: code,
            path: 'src/skill-experiment/constants/skill-experiment.constants.ts',
            detail:
              `${skill.outputDescription} Connected to Auto-improve (runtime ${skill.runtime}), ` +
              `with a suggested rubric of ${skill.suggestedRubric?.length ?? 0} criteria — an ` +
              'experiment on it can be switched on from System Skills → Auto-improve.',
          },
        });
      }
    }
    return hits;
  }

  /**
   * Learner surfaces built on both the learner web app and mobile.
   *
   * A request about one of these almost always means both — in session
   * 2bc3a5cf the PRD planned the debrief rating for `DebriefTab` on the web
   * only, and mobile has its own `DebriefTab`. Matched by component name, so a
   * pair that is named differently on the two platforms is missed; the list is
   * a prompt to check, not a complete inventory.
   */
  async parityTwins(): Promise<BuilderParityTwin[]> {
    const rows = await this.listCatalogs();
    const web = rows.find((row) => row.repo === 'ally-web');
    const mobile = rows.find((row) => row.repo === 'ally-mobile');
    if (!web || !mobile) return [];

    const webByName = new Map<string, BuilderCatalogEntry>();
    for (const entry of web.entries ?? []) {
      if (entry.kind === 'component' && entry.app === LEARNER_WEB_APP) {
        webByName.set(normaliseName(entry.name), entry);
      }
    }
    const twins: BuilderParityTwin[] = [];
    const seen = new Set<string>();
    for (const entry of mobile.entries ?? []) {
      if (entry.kind !== 'component') continue;
      const key = normaliseName(entry.name);
      if (seen.has(key) || GENERIC_COMPONENT_NAMES.has(key)) continue;
      const match = webByName.get(key);
      if (match) {
        seen.add(key);
        twins.push({ name: match.name, web: match.path, mobile: entry.path });
      }
    }
    return twins.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The part of the platform map every interview turn reads: the hand-written
   * capabilities and the web/mobile twins. Compact on purpose — it sits in the
   * cached prefix, and the detail is one lookup away.
   */
  async renderContextSection(): Promise<string> {
    const lines: string[] = [
      '# Reusable platform systems',
      '',
      'What Ally already runs that a new feature should reuse or extend before building anything. ' +
        'Before you propose a new table, job, screen, loop or prompt, check this list and run ' +
        '`capability_lookup` with the request’s own nouns (one to three words each). For anything ' +
        'involving an AI output, run `ai_tasks_lookup` to find which task and prompt produce it. ' +
        'If a system here already does part of the request, say so in What already exists and ' +
        'propose extending it.',
      '',
    ];
    for (const capability of BUILDER_CAPABILITIES) {
      lines.push(
        `- **${capability.name}** (${capability.modules.join(', ')}) — ${capability.whatItIs} ` +
          `Reuse when: ${capability.reuseWhen}`,
      );
    }

    const twins = await this.parityTwins();
    if (twins.length) {
      lines.push(
        '',
        '# Learner surfaces on both web and mobile',
        '',
        'These components exist in the learner web app (ally-web, ally-helpline-dashboard) and in ' +
          'ally-mobile. A change to one usually needs the other: plan ally-mobile too, or say in ' +
          'Non-goals why not.',
        '',
        twins.map((twin) => twin.name).join(', '),
      );
    }
    return lines.join('\n');
  }

  /**
   * ally-be modules no capability line covers and that are not plumbing — the
   * gaps in the hand-written half. Read from the ally-be catalog, so it is only
   * as current as the last refresh.
   */
  async coverage(): Promise<{
    uncoveredModules: string[];
    coveredModules: string[];
    generatedAt: Date | null;
  }> {
    const rows = await this.listCatalogs();
    const be = rows.find((row) => row.repo === 'ally-be');
    const modules = (be?.entries ?? [])
      .filter((entry) => entry.kind === 'module')
      .map((entry) => entry.name);
    const covered = new Set(
      BUILDER_CAPABILITIES.flatMap((capability) =>
        capability.modules
          .filter((module) => module.startsWith('ally-be:src/'))
          .map((module) => module.slice('ally-be:src/'.length).split('/')[0]),
      ),
    );
    return {
      coveredModules: modules.filter((name) => covered.has(name)),
      uncoveredModules: modules.filter(
        (name) =>
          !covered.has(name) && !BUILDER_CAPABILITY_EXEMPT_MODULES.has(name),
      ),
      generatedAt: be?.generatedAt ?? null,
    };
  }
}
