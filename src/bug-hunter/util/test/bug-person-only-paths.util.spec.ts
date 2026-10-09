import {
  describePersonOnlyPaths,
  personOnlyPaths,
} from '../bug-person-only-paths.util';

describe('personOnlyPaths', () => {
  it('names every file a person has to merge, with why, and leaves ordinary code alone', () => {
    const hits = personOnlyPaths([
      'src/health/controller/health.controller.ts',
      'src/health/controller/test/health.controller.spec.ts',
      '.claude/agents/bug-escalation.md',
      'pr-body.md',
      'docs/pr-body.md',
      'src/database/migrations/1975880000000-X.ts',
      'apps/ally-helpline-dashboard/src/i18n/locales/mr.json',
      'apps/ally-helpline-dashboard/src/i18n/locales/index.ts',
      'src/database/seeds/users.seed.ts',
      'src/x/__snapshots__/a.test.ts.snap',
      'package-lock.json',
      'poetry.lock',
      'src/generated/schema.ts',
      '.github/workflows/bug-hunt-sweep.yml',
    ]);
    expect(hits.map((h) => h.file)).toEqual([
      '.claude/agents/bug-escalation.md',
      'pr-body.md',
      'docs/pr-body.md',
      'src/database/migrations/1975880000000-X.ts',
      'apps/ally-helpline-dashboard/src/i18n/locales/mr.json',
      'src/database/seeds/users.seed.ts',
      'src/x/__snapshots__/a.test.ts.snap',
      'package-lock.json',
      'poetry.lock',
      'src/generated/schema.ts',
      '.github/workflows/bug-hunt-sweep.yml',
    ]);
    expect(hits.find((h) => h.file === 'pr-body.md')?.why).toBe(
      'a PR body written into the repo',
    );
    // a locale folder's index.ts is code, not data
    expect(hits.some((h) => h.file.endsWith('locales/index.ts'))).toBe(false);
  });

  it('describes the hits in one line and caps the list', () => {
    expect(
      describePersonOnlyPaths(
        personOnlyPaths(['pr-body.md', '.claude/agents/x.md']),
      ),
    ).toBe(
      'pr-body.md (a PR body written into the repo), .claude/agents/x.md (Bug Hunter agent files)',
    );
    const many = personOnlyPaths(
      Array.from({ length: 10 }, (_, i) => `src/migrations/${i}.ts`),
    );
    expect(describePersonOnlyPaths(many)).toMatch(/, and 2 more$/);
    expect(personOnlyPaths(['src/a.ts'])).toEqual([]);
  });
});
