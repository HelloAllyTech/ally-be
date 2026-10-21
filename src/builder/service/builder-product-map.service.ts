import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { FEATURE_TOGGLES } from 'src/authorization/constants/admin-feature-toggle.constants';
import { BuilderGithubReadService } from './builder-github-read.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderCatalogService } from './builder-catalog.service';
import {
  BUILDER_REPOS,
  BUILDER_WIKI_REPO,
} from '../constants/builder-repos.constants';

import { BUILDER_PRODUCT_MAP } from '../constants/builder.constants';

/** The wiki's own one-line-per-page index, generated from page frontmatter. */
const WIKI_ROUTING_PATH = 'wiki/ROUTING.md';

/**
 * Wiki index sections about working ON the codebase rather than what the product is — the
 * deprecated product-practice pages (Stacks replaced them), contributing, agent memory, the
 * skill template, the knowledge base's own meta pages.
 */
const WIKI_SECTIONS_DROPPED =
  /deprecated|contributing|agent memory|skills|start here|don.t load/i;

/** Root files that are process boilerplate in every repo, or a copy of the wiki index. */
const ROOT_DOCS_DROPPED = new Set([
  'AGENTS.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DEPLOYMENT.md',
  'DOCKER_TESTING_SETUP.md',
  'SECURITY.md',
  'TESTING.md',
  'WIKI-ROUTING.md',
  'pr_body.md',
]);

interface MapSection {
  text: string;
  /** False when a source could not be read — the result is then cached only briefly. */
  complete: boolean;
}

/**
 * What an agent knows about Ally *as built*, before it looks anything up — read by the
 * opportunity copilot whole, and by the Builder interview for the parts its own context does
 * not already carry (the reusable systems and the documentation index).
 *
 * It lives in Builder rather than in the roadmap because Builder owns every source it reads
 * (packs, catalog, GitHub reads), and the roadmap may depend on Builder but never the reverse.
 * One map, two readers: the copilot and the interview used to know different things about the
 * same product, and the interview — which knew less about what already exists — was the one
 * that proposed rebuilding Auto-improve in session 2bc3a5cf.
 *
 * ## Why this exists
 *
 * The copilot always had GitHub tools, and still asked questions that showed it did not know
 * the product. It started every conversation knowing the strategy and the board — what Ally
 * wants and what is queued — and nothing about what Ally IS: which screens exist, what they
 * are called, which repo owns what, which doc explains an area. A model that does not know a
 * place exists does not search for it, so the tools went unused and the questions stayed
 * generic. Builder's interviewer is codebase-aware for the same reason this is: its context
 * carries the repo knowledge packs and the admin feature registry.
 *
 * ## What it carries
 *
 * The repositories; the admin console's surfaces (the feature-toggle registry, one line per
 * real screen); the head of each repo's knowledge pack (Builder generates these from master);
 * the wiki's page index; and the list of markdown docs in every repo. It is an index, not the
 * content — it tells the copilot which one page to read, which the tools then do.
 *
 * ## Caching
 *
 * Rendered once and reused for `TTL_MS`. That keeps GitHub calls off the hot path (five tree
 * listings and a file read per turn would add seconds to every answer) and, as importantly,
 * keeps the text byte-identical across the turns of an interview, so it can sit in the cached
 * system prefix. A render where any source failed is reused only for `RETRY_TTL_MS`, so a
 * GitHub blip does not leave a hole in the map for half an hour. Concurrent turns share one
 * in-flight render.
 *
 * Never throws: every source fails soft into a line that says what could not be read — "no
 * map" must read as "look it up", never as "there is nothing there".
 */
@Injectable()
export class BuilderProductMapService {
  private readonly logger = LoggerService.getInstance(
    BuilderProductMapService.name,
  );

  private cached: { text: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  private docsCached: { text: string; expiresAt: number } | null = null;

  constructor(
    private readonly knowledge: BuilderKnowledgeService,
    private readonly githubRead: BuilderGithubReadService,
    private readonly catalog: BuilderCatalogService,
  ) {}

  /**
   * The documentation index alone — the wiki's page list and every repo's docs — for an agent
   * whose own context already carries the repositories, packs and admin surfaces. Cached on
   * the same terms as the full render.
   */
  async renderDocsIndex(): Promise<string> {
    if (this.docsCached && this.docsCached.expiresAt > Date.now()) {
      return this.docsCached.text;
    }
    const [wiki, docs] = await Promise.all([this.wikiIndex(), this.repoDocs()]);
    const text = [
      '# Documentation you can read',
      'Docs say what an area is for and why; read the one that matches before the code. ' +
        'docs_search finds pages not listed here.',
      wiki.text,
      docs.text,
    ].join('\n\n');
    this.docsCached = {
      text,
      expiresAt:
        Date.now() +
        (wiki.complete && docs.complete
          ? BUILDER_PRODUCT_MAP.TTL_MS
          : BUILDER_PRODUCT_MAP.RETRY_TTL_MS),
    };
    return text;
  }

  async render(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.text;
    }
    if (!this.inflight) {
      this.inflight = this.assemble()
        .then(({ text, complete }) => {
          this.cached = {
            text,
            expiresAt:
              Date.now() +
              (complete
                ? BUILDER_PRODUCT_MAP.TTL_MS
                : BUILDER_PRODUCT_MAP.RETRY_TTL_MS),
          };
          return text;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  private async assemble(): Promise<MapSection> {
    const [packs, wiki, docs, systems] = await Promise.all([
      this.repoPacks(),
      this.wikiIndex(),
      this.repoDocs(),
      this.catalog
        .renderContextSection()
        .then((text) => ({
          text: text.replace(/^# /gm, '## '),
          complete: true,
        }))
        .catch(() => ({ text: '', complete: false })),
    ]);
    const text = [
      '# Ally as built — the product map',
      'An index of what exists today, so you know where to look. It is read from the master ' +
        'branch, which can be ahead of what users have: something in the code may not have ' +
        'shipped yet. It is also incomplete — something missing here may still exist, so search ' +
        'before you say it does not.',
      this.repositories(),
      this.adminSurfaces(),
      systems.text,
      packs.text,
      '## Documentation you can read',
      wiki.text,
      docs.text,
    ].join('\n\n');
    return {
      text,
      complete: packs.complete && wiki.complete && docs.complete,
    };
  }

  private repositories(): string {
    return [
      '## Repositories',
      ...BUILDER_REPOS.map((repo) => `- ${repo.repo} — ${repo.description}`),
      `- ${BUILDER_WIKI_REPO} — the platform wiki: architecture, how the services fit ` +
        'together, and why. Read it with wiki_read.',
    ].join('\n');
  }

  /**
   * Every admin console area is gated by one of these, so the list doubles as the console's
   * table of contents — the names the admin sees on screen.
   */
  private adminSurfaces(): string {
    return [
      "## The admin console's surfaces",
      'Each admin area sits behind one feature toggle; the label is what the admin sees on ' +
        'screen, and the key is what the code calls it.',
      ...FEATURE_TOGGLES.map(
        (toggle) =>
          `- ${toggle.label} (\`${toggle.key}\`) — ${toggle.description}`,
      ),
    ].join('\n');
  }

  /**
   * The head of each repo's knowledge pack. The packs are written for a coding agent and put
   * "what this repo is" and the module inventory first, conventions and commands after — so
   * cutting each one at a fixed length keeps exactly the part a product conversation uses.
   */
  private async repoPacks(): Promise<MapSection> {
    const header =
      '## Inside each repo — the head of its knowledge pack (what it is, its modules)';
    try {
      const maps = await this.knowledge.listRepoMaps();
      const byRepo = new Map(maps.map((map) => [map.repo, map]));
      const lines = [header];
      for (const { repo } of BUILDER_REPOS) {
        const map = byRepo.get(repo);
        const body = map?.mapMd?.trim() ?? '';
        // A pack this short is a failed generation ("Done.", a refusal), not a map.
        if (body.length < BUILDER_PRODUCT_MAP.MIN_USABLE_PACK_CHARS) {
          lines.push(
            `### ${repo}\n\nNo usable knowledge pack. Learn this repo with docs_search, ` +
              'github_repo_tree and its README before saying how anything in it works.',
          );
          continue;
        }
        const stamp = [
          map!.commitSha ? `at ${map!.commitSha.slice(0, 7)}` : null,
          map!.generatedAt
            ? `generated ${new Date(map!.generatedAt).toISOString().slice(0, 10)}`
            : null,
        ]
          .filter(Boolean)
          .join(', ');
        const cut = body.length > BUILDER_PRODUCT_MAP.PACK_MAX_CHARS;
        lines.push(
          `### ${repo}${stamp ? ` (${stamp})` : ''}\n\n${
            cut
              ? `${body.slice(0, BUILDER_PRODUCT_MAP.PACK_MAX_CHARS)}\n\n… [cut here — the rest of this pack is conventions and commands]`
              : body
          }`,
        );
      }
      return { text: lines.join('\n\n'), complete: true };
    } catch (error) {
      this.logger.warn(
        `[BUILDER] Product map: knowledge packs unavailable: ${(error as Error)?.message}`,
      );
      return {
        text: `${header}\n\nCould not be read this time. Use docs_search and github_repo_tree.`,
        complete: false,
      };
    }
  }

  /**
   * The wiki's routing index, minus its preamble (fetch instructions for humans), its footer,
   * and the sections about working on the codebase rather than what it is — above all the
   * DEPRECATED product-practice pages, which Stacks replaced and which would otherwise be
   * offered as current guidance. Headings are demoted to sit under this section's own.
   */
  private async wikiIndex(): Promise<MapSection> {
    const header = `### The wiki — read with wiki_read, path "wiki/" + the path below (e.g. "wiki/platform/architecture.md")`;
    const result: Record<string, any> = await this.githubRead
      .readFile(BUILDER_WIKI_REPO, WIKI_ROUTING_PATH)
      .catch((error: Error) => ({ ok: false, message: error?.message }));
    if (!result?.ok || typeof result.content !== 'string') {
      return {
        text: `${header}\n\nThe page index could not be read (${String(
          result?.message ?? result?.error ?? 'unknown error',
        )}). Use wiki_search.`,
        complete: false,
      };
    }
    const sections: string[] = result.content.split(/^(?=## )/m);
    const kept = sections
      .filter((section) => section.startsWith('## '))
      .filter(
        (section) =>
          !WIKI_SECTIONS_DROPPED.test(section.slice(0, section.indexOf('\n'))),
      )
      .map((section) =>
        section
          .replace(/^## /, '#### ')
          .split('\n')
          // The footer is an italic page/word count for people choosing what to load.
          .filter((line) => !/^_.*_$/.test(line.trim()))
          .join('\n'),
      )
      .join('')
      .trim();
    return {
      text: `${header}\n\n${bound(kept, BUILDER_PRODUCT_MAP.WIKI_INDEX_MAX_CHARS)}`,
      complete: true,
    };
  }

  /** Every repo's markdown docs, one line per repo — read any of them with github_read_file. */
  private async repoDocs(): Promise<MapSection> {
    const header =
      '### Docs in each repo — read with github_read_file (repo, path)';
    const results: Record<string, any>[] = await Promise.all(
      BUILDER_REPOS.map(({ repo }) =>
        this.githubRead
          .listDocs(repo)
          .catch((error: Error) => ({ ok: false, message: error?.message })),
      ),
    );
    let complete = true;
    const lines = BUILDER_REPOS.map(({ repo }, index) => {
      const result = results[index];
      if (!result?.ok) {
        complete = false;
        return `- ${repo}: could not be listed (${String(
          result?.message ?? result?.error ?? 'unknown error',
        )})`;
      }
      const files: string[] = (
        Array.isArray(result.files) ? result.files : []
      ).filter((path: string) => !ROOT_DOCS_DROPPED.has(path));
      if (!files.length) return `- ${repo}: no markdown docs`;
      const shown = files.slice(0, BUILDER_PRODUCT_MAP.DOCS_PER_REPO);
      const more = files.length - shown.length;
      return `- ${repo}: ${shown.join(', ')}${more > 0 ? `, and ${more} more (docs_search finds them)` : ''}`;
    });
    return { text: [header, ...lines].join('\n'), complete };
  }
}

const bound = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}\n… [index cut here]`;
