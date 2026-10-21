import * as fs from 'fs';
import * as path from 'path';
import {
  BUILDER_CAPABILITIES,
  BUILDER_CAPABILITY_EXEMPT_MODULES,
} from '../builder-capabilities.constants';

/**
 * The hand-written half of the platform map is only useful while it is true.
 * A line that names a module that was renamed sends the interview to read a
 * path that 404s — the exact failure that let session 2bc3a5cf describe code
 * it had never read.
 */
describe('BUILDER_CAPABILITIES', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');

  it('names only ally-be paths that exist', () => {
    const missing = BUILDER_CAPABILITIES.flatMap((capability) =>
      [...capability.modules, ...(capability.docs ?? [])]
        .filter((ref) => ref.startsWith('ally-be:'))
        .map((ref) => ref.slice('ally-be:'.length))
        .filter((rel) => !fs.existsSync(path.join(repoRoot, rel)))
        .map((rel) => `${capability.id}: ${rel}`),
    );
    expect(missing).toEqual([]);
  });

  it('gives every capability a unique id, a purpose, a reuse rule and lowercase keywords', () => {
    const ids = BUILDER_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of BUILDER_CAPABILITIES) {
      expect(capability.whatItIs.trim().length).toBeGreaterThan(20);
      expect(capability.reuseWhen.trim().length).toBeGreaterThan(20);
      expect(capability.modules.length).toBeGreaterThan(0);
      expect(capability.keywords.length).toBeGreaterThan(0);
      for (const keyword of capability.keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
      }
    }
  });

  it('points every repo-qualified path at a known repo', () => {
    const repos = new Set([
      'ally-be',
      'ally-web',
      'ally-ai',
      'ally-ai-learn',
      'ally-mobile',
      'helloallytech.github.io',
    ]);
    const bad = BUILDER_CAPABILITIES.flatMap((capability) =>
      [...capability.modules, ...(capability.docs ?? [])].filter(
        (ref) => !repos.has(ref.split(':')[0]),
      ),
    );
    expect(bad).toEqual([]);
  });

  /**
   * Every ally-be module has a reuse line or is declared plumbing. A new
   * feature module that lands without one fails here, because a system the
   * interview cannot find is a system it will propose building again — the
   * failure in session 2bc3a5cf. Fix it by adding a capability entry (or the
   * module to an existing one), or by exempting it as plumbing.
   */
  it('covers every ally-be module with a reuse line or an exemption', () => {
    const srcDir = path.join(repoRoot, 'src');
    const modules = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) =>
        fs
          .readdirSync(path.join(srcDir, name))
          .some((file) => file.endsWith('.module.ts')),
      );
    const covered = new Set(
      BUILDER_CAPABILITIES.flatMap((capability) =>
        capability.modules
          .filter((ref) => ref.startsWith('ally-be:src/'))
          .map((ref) => ref.slice('ally-be:src/'.length).split('/')[0]),
      ),
    );
    const uncovered = modules.filter(
      (name) =>
        !covered.has(name) && !BUILDER_CAPABILITY_EXEMPT_MODULES.has(name),
    );
    expect(uncovered).toEqual([]);
    // Every exempt name must still be a real module, or the list rots silently.
    const staleExempt = [...BUILDER_CAPABILITY_EXEMPT_MODULES].filter(
      (name) => !modules.includes(name),
    );
    expect(staleExempt).toEqual([]);
  });
});
