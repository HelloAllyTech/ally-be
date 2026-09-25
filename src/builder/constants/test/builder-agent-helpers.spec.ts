import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { BuilderStage } from '../../enum/builder.enum';
import { buildPromptHeader } from '../builder-build-prompt';

const HELPER_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'builder',
  'agent-helpers',
);

const helperNames = (): string[] =>
  readdirSync(HELPER_DIR).filter(
    (name) =>
      !name.startsWith('_') &&
      !name.endsWith('.md') &&
      statSync(join(HELPER_DIR, name)).isFile(),
  );

/**
 * The reporting protocol is a set of executables on the agent's PATH. Two
 * properties have to hold for that to work at all, and both were broken at
 * some point while building it.
 */
describe('builder agent helpers', () => {
  /**
   * `complete` is a bash BUILTIN — programmable completion — and bash resolves
   * builtins before PATH. A helper by that name could never be invoked from
   * any shell, however early its directory sits on PATH.
   *
   * It survived review because the protocol previously shipped as shell
   * FUNCTION definitions inside the prompt, and functions outrank builtins. So
   * the name worked for exactly as long as it was a function and broke the
   * moment it became a file — and it would have broken silently, in the one
   * call that records a run's outcome: every run on every engine filed as
   * "ended without reporting an outcome", with its work pushed and green.
   */
  it.each(helperNames())(
    '%s is not shadowed by a bash builtin or keyword',
    (name) => {
      // Absolute path, because PATH is emptied below: bash itself has to be
      // findable while the lookup under test must not be.
      const kind = execFileSync(
        '/bin/bash',
        ['-c', `type -t ${name} || true`],
        {
          encoding: 'utf8',
          // An empty PATH cannot turn up one of our own files by accident, so
          // anything reported here is genuinely built into the shell.
          env: { PATH: '' },
        },
      ).trim();

      expect(kind).toBe('');
    },
  );

  /**
   * The progress rail is driven entirely by these values, and the `stage`
   * helper refuses anything outside the set — an agent inventing `EXECUTION`
   * or `FINALIZING` either moves the rail somewhere undefined or, where the
   * column's CHECK constraint refuses it, leaves it frozen at the last real
   * stage. Both read as the rail being broken.
   *
   * The helper carries its own copy because it is shell. This is the thing
   * that stops the two drifting.
   */
  it('refuses exactly the stages the enum does not define', () => {
    const helper = readFileSync(join(HELPER_DIR, 'stage'), 'utf8');
    const declared = helper.match(/^STAGES="([^"]+)"/m)?.[1]?.split(' ') ?? [];

    expect(declared.sort()).toEqual(Object.values(BuilderStage).sort());
  });

  /**
   * The same stages again, in the MCP server.
   *
   * There are now three copies of this list — the enum, the shell helper and
   * the MCP tool's `enum` schema — because the protocol is offered over two
   * channels to engines that each know only one of them. Three copies is one
   * more chance to drift, and a drifted list does not fail loudly: the rail
   * simply stops moving, or freezes at the last stage the CHECK constraint
   * accepted.
   */
  it('offers exactly the stages the enum defines, over MCP too', () => {
    const server = readFileSync(
      join(HELPER_DIR, '..', 'builder-mcp.mjs'),
      'utf8',
    );
    const block = server.match(/const STAGES = \[([^\]]+)\]/)?.[1] ?? '';
    const declared = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);

    expect(declared.sort()).toEqual(Object.values(BuilderStage).sort());
  });

  /**
   * A helper the prompt never mentions is one no agent will call, and a name
   * in the prompt with no helper behind it is `command not found` mid-run.
   */
  it('documents exactly the helpers that exist', () => {
    const header = buildPromptHeader({
      sessionId: 's',
      runId: 'r',
      branchSlug: 'b',
      apiBaseUrl: 'http://be',
      repos: [],
      role: 'coding agent',
    });

    for (const name of helperNames()) {
      expect(header).toContain(name);
    }
  });
});
