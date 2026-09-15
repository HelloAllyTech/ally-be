import { NestFactory } from '@nestjs/core';
import { validationSchema } from './config/env.validation';

/**
 * The guard that was missing on 2026-09-15.
 *
 * v1.109.0 passed Jest, Lint & format, docs-guard, gitleaks, Workflow lint and
 * the Builder runner harnesses, then exited 1 on boot in production:
 *
 *   Nest can't resolve dependencies of the BuilderBuildService (...).
 *   Please make sure that the argument LlmModelsRepository at index [8]
 *   is available in the BuilderModule module.
 *
 * A service had gained an injected repository while its module never imported
 * the module providing it. The ECS circuit breaker rolled the release back and
 * prod sat on the previous version for the better part of an hour.
 *
 * Nothing in CI could have caught it. Every service spec constructs its subject
 * directly with mocked collaborators, so the module graph is resolved nowhere
 * in the suite — which makes adding an injected dependency an unguarded change,
 * and makes a rolled-back production deploy the first line of defence.
 *
 * This resolves the real graph, every module, exactly as boot does.
 *
 * Why `preview: true` rather than a normal bootstrap: preview mode performs
 * full dependency resolution and then returns from `instantiateClass` before
 * calling any constructor or factory (see @nestjs/core injector.js — the
 * `options?.preview` branch sits after `resolveConstructorParams`). So an
 * unresolvable dependency still throws, while nothing opens a socket: no
 * Postgres, no Redis, no SQS, no HTTP listener. The test needs no services
 * running and is safe on any machine.
 *
 * Verified against both injection shapes in this codebase, by reintroducing a
 * break and watching this fail:
 *   - a service injecting a class its module never imported (the v1.109.0 bug,
 *     reproduced verbatim);
 *   - an `@InjectRepository(X)` whose entity is missing from the module's
 *     `TypeOrmModule.forFeature`.
 *
 * What this does NOT cover:
 *   - Removing an entity from `forFeature` when the consumer is one of the ~134
 *     custom `extends Repository` classes. Those take `DataSource` and read
 *     their metadata from DatabaseModule's global entity list, so `forFeature`
 *     is not a wiring edge for them and dropping one changes nothing here.
 *     Only the ~42 `@InjectRepository` call sites depend on it.
 *   - Anything that fails after wiring: a bad migration, a query against a
 *     missing column, a constructor that throws on real config. Nothing is
 *     constructed, by design.
 *
 * It answers one question, which is the question that broke us: can Nest build
 * this graph at all?
 */

/**
 * Placeholders for every `.required()` key, derived from the schema rather than
 * listed here.
 *
 * A hardcoded list would go stale the first time someone adds a required
 * variable, and it would go stale as a *failure* — this test would start
 * failing for a reason that has nothing to do with wiring, and the next person
 * would learn to distrust it. Reading the schema means a new required variable
 * is handled the moment it is declared.
 *
 * These values are syntactic filler to satisfy Joi. Nothing connects anywhere.
 */
const stubEnvFromSchema = (): Record<string, string> => {
  const described = validationSchema.describe() as {
    keys: Record<
      string,
      {
        type?: string;
        flags?: { presence?: string };
        rules?: { name: string; args?: { regex?: string } }[];
      }
    >;
  };

  const env: Record<string, string> = {};

  Object.entries(described.keys ?? {}).forEach(([key, spec]) => {
    if (spec.flags?.presence !== 'required') return;
    if (process.env[key]) return;

    // Joi's `pattern` rules reject generic filler, so honour the ones we have.
    // The regex source is all we get from describe(); matching on the tail of a
    // filename covers the file-path patterns this schema uses, and an
    // unrecognised pattern is loud rather than silently wrong.
    const pattern = spec.rules?.find((rule) => rule.name === 'pattern');
    if (pattern) {
      const source = String(pattern.args?.regex ?? '');
      const extension = source.match(/\\\.([a-z0-9]+)\$/i)?.[1];
      if (!extension) {
        throw new Error(
          `${key} has a Joi pattern this test does not know how to satisfy ` +
            `(${source}). Add a case for it in stubEnvFromSchema.`,
        );
      }
      env[key] = `/tmp/placeholder.${extension}`;
      return;
    }

    env[key] = spec.type === 'number' ? '1' : 'placeholder';
  });

  return env;
};

describe('AppModule', () => {
  const original = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, stubEnvFromSchema());
    // 'test' is in the schema's allowed NODE_ENV values and keeps any
    // environment-sensitive module on its least surprising branch.
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = original;
  });

  it('resolves every dependency in the graph', async () => {
    // Imported here, not at the top of the file: AppModule's decorator runs at
    // import time and reads config, so the stub environment has to be in place
    // first.
    const { AppModule } = await import('./app.module');

    const context = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
      abortOnError: false,
    });

    await context.close();
  }, 120_000);
});
