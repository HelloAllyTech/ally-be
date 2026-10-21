import { FEATURE_TOGGLES } from 'src/authorization/constants/admin-feature-toggle.constants';
import { BUILDER_REPOS } from 'src/builder/constants/builder-repos.constants';

import { BuilderProductMapService } from '../builder-product-map.service';
import { BUILDER_PRODUCT_MAP } from '../../constants/builder.constants';

const ROUTING = [
  '# Wiki routing index',
  '',
  '**Generated — do not edit.** Fetch as https://tech.helloally.ai/#/wiki/<path>.',
  '',
  '## Product practice — DEPRECATED 2026-08-07, superseded by the Stacks MCP; history only',
  '',
  '- `product/ui.md` (1735w) — How Ally screens should behave…',
  '',
  '## Platform & architecture',
  '',
  '- `platform/architecture.md` (683w) — How Ally’s services connect…',
  '',
  '## Per-repo pages',
  '',
  '- `repos/ally-be.md` (4046w) — ally-be is the multi-tenant NestJS backend…',
  '',
  '## Contributing & setup',
  '',
  '- `contributing/guide.md` (767w) — Branch naming, commit conventions…',
  '',
  "## Don't load these for a task",
  '',
  '- `log.md` — append-only history',
  '',
  '_43 pages, 73,221 words total._',
  '',
].join('\n');

const pack = (repo: string, body: string) => ({
  repo,
  mapMd: body,
  commitSha: '4d73f058c8864ad14cdca4fe99aff016f0c9fbe1',
  generatedAt: new Date('2026-10-18T03:15:52.518Z'),
});

/**
 * The copilot used to start every conversation knowing the strategy and the board but nothing
 * about the product as built, so it never knew what to look up. This map is that knowledge.
 * What matters: each source is present when it can be read, says so plainly when it cannot,
 * and the whole thing is cached — briefly when anything failed.
 */
describe('BuilderProductMapService', () => {
  const build = (
    over: {
      maps?: any[] | Error;
      routing?: Record<string, any>;
      docs?: (repo: string) => Record<string, any>;
    } = {},
  ) => {
    const knowledge = {
      listRepoMaps: jest.fn(async () => {
        if (over.maps instanceof Error) throw over.maps;
        return (
          over.maps ?? [
            pack('ally-be', 'ally-be owns the database.\n\n' + 'x'.repeat(600)),
          ]
        );
      }),
    };
    const githubRead = {
      readFile: jest.fn(
        async () => over.routing ?? { ok: true, content: ROUTING },
      ),
      listDocs: jest.fn(
        async (repo: string) =>
          over.docs?.(repo) ?? {
            ok: true,
            files: ['README.md', 'CLAUDE.md', `docs/${repo}-guide.md`],
          },
      ),
    };
    const catalog = {
      renderContextSection: jest.fn(
        async () =>
          '# Reusable platform systems\n\n- **Auto-improve** (ally-be:src/skill-experiment) — tests prompt versions.',
      ),
    };
    const service = new BuilderProductMapService(
      knowledge as any,
      githubRead as any,
      catalog as any,
    );
    return { service, knowledge, githubRead, catalog };
  };

  afterEach(() => jest.useRealTimers());

  it('lists every repo, every admin surface, the packs and the documentation index', async () => {
    const text = await build().service.render();

    for (const { repo } of BUILDER_REPOS)
      expect(text).toContain(`- ${repo} — `);
    for (const toggle of FEATURE_TOGGLES) {
      expect(text).toContain(`- ${toggle.label} (\`${toggle.key}\`)`);
    }
    expect(text).toContain('### ally-be (at 4d73f05, generated 2026-10-18)');
    expect(text).toContain('ally-be owns the database.');
    expect(text).toContain('`platform/architecture.md`');
    expect(text).toContain(
      '- ally-web: README.md, CLAUDE.md, docs/ally-web-guide.md',
    );
    // It warns that master is not what users have — the code can be ahead of a release.
    expect(text).toMatch(/ahead of what users have/);
  });

  it('keeps the wiki pages about the product and drops the ones about working on it', async () => {
    const text = await build().service.render();

    expect(text).toContain('#### Platform & architecture');
    expect(text).toContain('#### Per-repo pages');
    // Deprecated product practice (Stacks replaced it), process pages, meta pages, preamble.
    expect(text).not.toContain('product/ui.md');
    expect(text).not.toContain('contributing/guide.md');
    expect(text).not.toContain('log.md');
    expect(text).not.toContain('Fetch as');
    expect(text).not.toContain('73,221 words');
  });

  it('leaves process boilerplate out of the repo docs list', async () => {
    const text = await build({
      docs: () => ({
        ok: true,
        files: ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'DATA_SCHEMA.md'],
      }),
    }).service.render();

    expect(text).toContain('- ally-be: README.md, DATA_SCHEMA.md\n');
  });

  /**
   * Prod held packs of 54 and 235 characters — failed generations. Rendered as-is, they read
   * as "this repo has nothing in it".
   */
  it('treats a pack too short to be a map as missing, and says how to learn the repo instead', async () => {
    const text = await build({
      maps: [pack('ally-ai-learn', 'Done.')],
    }).service.render();

    expect(text).not.toContain('Done.');
    expect(text).toMatch(/### ally-ai-learn\n\nNo usable knowledge pack/);
    // A repo with no row at all reads the same way.
    expect(text).toMatch(/### ally-mobile\n\nNo usable knowledge pack/);
  });

  it('keeps the head of a long pack and marks the cut', async () => {
    const head = 'MODULE INVENTORY ';
    const text = await build({
      maps: [
        pack(
          'ally-be',
          head + 'y'.repeat(BUILDER_PRODUCT_MAP.PACK_MAX_CHARS * 2),
        ),
      ],
    }).service.render();

    expect(text).toContain(head);
    expect(text).toMatch(/cut here/);
    expect(text).not.toContain('y'.repeat(BUILDER_PRODUCT_MAP.PACK_MAX_CHARS));
  });

  it('caps the doc paths per repo and points at docs_search for the rest', async () => {
    const many = Array.from(
      { length: BUILDER_PRODUCT_MAP.DOCS_PER_REPO + 5 },
      (_, i) => `docs/page-${i}.md`,
    );
    const text = await build({
      docs: () => ({ ok: true, files: many }),
    }).service.render();

    expect(text).toContain('and 5 more (docs_search finds them)');
    expect(text).not.toContain(
      `docs/page-${BUILDER_PRODUCT_MAP.DOCS_PER_REPO}.md`,
    );
  });

  it('says what could not be read rather than leaving a silent gap', async () => {
    const text = await build({
      maps: new Error('db down'),
      routing: { ok: false, error: 'github_not_configured' },
      docs: () => ({ ok: false, error: 'github_not_configured' }),
    }).service.render();

    expect(text).toMatch(/knowledge pack[^\n]*\n\nCould not be read this time/);
    expect(text).toMatch(
      /page index could not be read \(github_not_configured\)/,
    );
    expect(text).toContain(
      '- ally-be: could not be listed (github_not_configured)',
    );
    // The parts that need no network are still there.
    expect(text).toContain(`(\`${FEATURE_TOGGLES[0].key}\`)`);
  });

  describe('caching', () => {
    it('renders once and reuses the text, so the prefix stays byte-identical across turns', async () => {
      const { service, githubRead, knowledge } = build();

      const first = await service.render();
      const second = await service.render();

      expect(second).toBe(first);
      expect(knowledge.listRepoMaps).toHaveBeenCalledTimes(1);
      expect(githubRead.readFile).toHaveBeenCalledTimes(1);
      expect(githubRead.listDocs).toHaveBeenCalledTimes(BUILDER_REPOS.length);
    });

    it('shares one render between concurrent turns', async () => {
      const { service, knowledge } = build();

      await Promise.all([service.render(), service.render(), service.render()]);

      expect(knowledge.listRepoMaps).toHaveBeenCalledTimes(1);
    });

    it('re-renders after the TTL', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00Z') });
      const { service, knowledge } = build();

      await service.render();
      jest.setSystemTime(Date.now() + BUILDER_PRODUCT_MAP.TTL_MS - 1_000);
      await service.render();
      expect(knowledge.listRepoMaps).toHaveBeenCalledTimes(1);

      jest.setSystemTime(Date.now() + 2_000);
      await service.render();
      expect(knowledge.listRepoMaps).toHaveBeenCalledTimes(2);
    });

    it('retries soon after a render in which a source failed', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00Z') });
      const { service, githubRead } = build({
        routing: { ok: false, error: 'search_failed' },
      });

      await service.render();
      jest.setSystemTime(Date.now() + BUILDER_PRODUCT_MAP.RETRY_TTL_MS + 1_000);
      await service.render();

      expect(githubRead.readFile).toHaveBeenCalledTimes(2);
    });
  });
  it('carries the reusable systems, so the copilot knows what already exists', async () => {
    const text = await build().service.render();

    expect(text).toContain('## Reusable platform systems');
    expect(text).toContain('**Auto-improve**');
  });

  it('renders the documentation index on its own for the Builder interview', async () => {
    const text = await build().service.renderDocsIndex();

    expect(text).toContain('# Documentation you can read');
    expect(text).toContain('`platform/architecture.md`');
    expect(text).toContain(
      '- ally-web: README.md, CLAUDE.md, docs/ally-web-guide.md',
    );
    // Not the parts the interview's own context already carries.
    expect(text).not.toContain("## The admin console's surfaces");
  });
});
