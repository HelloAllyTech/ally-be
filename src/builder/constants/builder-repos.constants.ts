/**
 * The repos Builder may read during an interview and write during a build,
 * with the commands that prove a change is sound in each.
 *
 * Hand-maintained on purpose (same call as BUG_HUNT_REPOS): an unknown repo
 * should 400 at the API boundary rather than reach a runner that will clone
 * something nobody vetted. Single definition, several readers — the interview
 * tools validate against it, the build prompt embeds it, and the pipeline
 * serves it over GET /v1/builder/pipeline/repo-commands.
 */
export interface BuilderRepoDefinition {
  /** Repository name under the GitHub org. */
  repo: string;
  /** One line the agent reads to decide whether a change belongs here. */
  description: string;
  test: string;
  lint: string;
  /** Null where the repo's test/build step already covers types. */
  typecheck: string | null;
  /** Whether the repo can be stood up in a runner for live E2E. */
  e2eCapable: boolean;
  serveCommand?: string;
  port?: number;
  /**
   * Paths where a change is high-blast-radius (auth, migrations, payments).
   * The verifier pass is told to scrutinise diffs touching these, and a build
   * that touches one never merges itself.
   */
  guardedPaths: string[];
}

export const BUILDER_REPOS: BuilderRepoDefinition[] = [
  {
    repo: 'ally-be',
    description:
      'NestJS + TypeORM backend owning the primary Postgres database, admin APIs, auth and permissions.',
    test: 'npm test',
    lint: 'npm run lint',
    typecheck: 'npm run build',
    e2eCapable: true,
    serveCommand: 'npm run start:dev',
    port: 8001,
    guardedPaths: [
      'src/auth',
      'src/authorization',
      'src/database/migrations',
      'src/payment',
      'src/user',
    ],
  },
  {
    repo: 'ally-web',
    description:
      'Nx monorepo of the three frontends: admin dashboard, helpline and web. Shared libs under libs/.',
    test: 'npx nx run-many -t test --skip-nx-cache',
    lint: 'npx nx run-many -t lint --skip-nx-cache',
    typecheck: 'npx tsc -b --pretty false',
    e2eCapable: true,
    serveCommand: 'npx nx serve ally-admin-dashboard',
    port: 8081,
    guardedPaths: [
      'libs',
      'apps/*/src/routes',
      'apps/*/src/constants/permissions.ts',
    ],
  },
  {
    repo: 'ally-ai',
    description:
      'FastAPI + Weaviate service for retrieval, embeddings and the RAG agents.',
    test: 'poetry run pytest tests/ -v',
    lint: 'poetry run flake8',
    typecheck: null,
    e2eCapable: false,
    guardedPaths: ['app/auth', 'app/core/config.py'],
  },
  {
    repo: 'ally-ai-learn',
    description:
      'LiveKit voice agent running roleplay sessions (Studio v1 worker and the spec-driven v2 worker).',
    test: 'poetry run pytest tests/ -v',
    lint: 'poetry run flake8',
    typecheck: null,
    e2eCapable: false,
    guardedPaths: ['app/auth', 'app/core/config.py'],
  },
  {
    repo: 'ally-mobile',
    description: 'React Native mobile client.',
    test: 'npm test',
    lint: 'npm run lint',
    typecheck: 'npx tsc --noEmit',
    e2eCapable: false,
    guardedPaths: ['src/navigation', 'src/api'],
  },
];

export const BUILDER_REPO_NAMES: string[] = BUILDER_REPOS.map((r) => r.repo);

export function findBuilderRepo(
  repo: string,
): BuilderRepoDefinition | undefined {
  return BUILDER_REPOS.find((entry) => entry.repo === repo);
}

export function isBuilderRepo(repo: string): boolean {
  return BUILDER_REPO_NAMES.includes(repo);
}
