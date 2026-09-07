import * as fs from 'fs';
import * as path from 'path';
import { AI_TASK_REGISTRY, tierForAiTask } from '../ai-task-registry.constants';

/**
 * Every AI-task id used in code must resolve to a tier in the registry.
 *
 * This exists because of a production break. `LlmCompletionService` reads a
 * task's tier from the registry via `tierForAiTask`, which THROWS for a row
 * with no tier — deliberately, so a call with no registry entry surfaces
 * loudly rather than quietly running on the cheap tier. The autofill collapse
 * moved three call sites onto that path in one commit and added their `tier`
 * fields in the next, so the first commit shipped alone and every Generate,
 * Enhance and Agent-Builder field call 500'd in production with
 * "AI task \"autofill-enhance-field\" has no tier in the AI task registry".
 *
 * 2175 unit tests and a clean lint gate said nothing, because the only place
 * that failure exists is where the real service meets the real registry:
 * `scenario.service.spec.ts` mocks AutofillService wholesale, and no unit test
 * constructs the real one. So the guard has to be static — read the source,
 * find the ids, resolve each against the real registry.
 *
 * It is deliberately a scan rather than a runtime assertion. A runtime check
 * would only fire on the first call after a deploy, which is exactly how this
 * escaped: by then an author is already looking at a red toast.
 */
describe('AI task ids used in code', () => {
  const srcRoot = path.join(__dirname, '..', '..', '..');

  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' ? [] : sourceFiles(full);
      }
      // Specs are excluded: a test may legitimately use a made-up id to prove
      // the throwing behaviour itself.
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [full]
        : [];
    });

  /**
   * Ids referenced from a file, however they are written.
   *
   * Covers the three shapes actually in use: a `taskId:` given a literal, a
   * `taskId:` given the file's own `AI_TASK_ID` constant (the common case —
   * every migrated service declares one), and a direct `tierForAiTask(...)`
   * call. A fourth shape would slip past this, which is why the message on
   * failure names the file rather than only the id.
   */
  const idsReferencedBy = (contents: string): string[] => {
    const ids = new Set<string>();
    const own = contents.match(/const AI_TASK_ID = '([^']+)'/)?.[1];

    for (const [, literal] of contents.matchAll(/taskId: '([^']+)'/g)) {
      ids.add(literal);
    }
    for (const [, literal] of contents.matchAll(
      /tierForAiTask\('([^']+)'\)/g,
    )) {
      ids.add(literal);
    }
    if (
      own &&
      /taskId: AI_TASK_ID|tierForAiTask\(AI_TASK_ID\)/.test(contents)
    ) {
      ids.add(own);
    }
    return [...ids];
  };

  const referenced = sourceFiles(srcRoot)
    .map((file) => ({
      file,
      ids: idsReferencedBy(fs.readFileSync(file, 'utf8')),
    }))
    .filter((entry) => entry.ids.length);

  it('finds the call sites at all', () => {
    // A refactor that renames `AI_TASK_ID` or the `taskId:` key would empty the
    // scan and turn every assertion below into a silent pass, which is worse
    // than no test. The floor is the nine services migrated off their own
    // Anthropic clients plus autofill.
    expect(referenced.length).toBeGreaterThanOrEqual(8);
  });

  it('resolves a tier for every id, so no call site can 500 on first use', () => {
    const unresolved = referenced.flatMap(({ file, ids }) =>
      ids
        .filter((id) => {
          try {
            tierForAiTask(id);
            return false;
          } catch {
            return true;
          }
        })
        .map((id) => `${path.relative(srcRoot, file)} -> "${id}"`),
    );

    expect(unresolved).toEqual([]);
    // If this failed: the id above is passed to LlmCompletionService but its
    // registry row has no `tier` (or no row exists). Add the tier in
    // ai-task-registry.constants.ts IN THE SAME COMMIT as the call site —
    // splitting the two is what caused the outage this test documents.
  });

  it('uses an id that exists in the registry', () => {
    const known = new Set(AI_TASK_REGISTRY.map((entry) => entry.id));
    const unknown = referenced.flatMap(({ file, ids }) =>
      ids
        .filter((id) => !known.has(id))
        .map((id) => `${path.relative(srcRoot, file)} -> "${id}"`),
    );

    // Separate from the tier assertion so the failure says which mistake it
    // is: a typo in the id, versus a real row that is missing its tier.
    expect(unknown).toEqual([]);
  });
});
