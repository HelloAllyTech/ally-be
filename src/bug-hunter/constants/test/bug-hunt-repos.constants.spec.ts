import {
  BUG_HUNT_REPOS,
  repoCommands,
  verifyCommandsList,
} from '../bug-hunt-repos.constants';

describe('verifyCommandsList', () => {
  it('joins two commands with "and", no typecheck present', () => {
    expect(
      verifyCommandsList({
        test: 'a',
        lint: 'b',
        fixable: true,
        canBotMerge: true,
      }),
    ).toBe('"a" and "b"');
  });

  it('lists all three with an Oxford comma once typecheck is present', () => {
    expect(
      verifyCommandsList({
        test: 'a',
        lint: 'b',
        typecheck: 'c',
        fixable: true,
        canBotMerge: true,
      }),
    ).toBe('"a", "b", and "c"');
  });
});

describe('BUG_HUNT_REPOS typecheck coverage', () => {
  // Confirmed directly against each repo's own `.github/workflows/test.yml`:
  // ally-be and ally-web both run a separate, blocking TypeScript compile
  // that ESLint/ESLint-flake8 never catches — the real, recurring cause of a
  // fix that passed Bug Hunter's own check and then failed the PR the moment
  // someone tried to merge it. The other three repos' CI has no equivalent
  // gate (ally-mobile's `tsc --noEmit` exists only in a local Husky
  // pre-commit hook, never in CI), so adding one here would just make Bug
  // Hunter fail fixes over something that was never going to block the PR.
  it('has a typecheck command for ally-be and ally-web only', () => {
    expect(repoCommands('ally-be')?.typecheck).toBe(
      'npx tsc --noEmit -p tsconfig.json',
    );
    expect(repoCommands('ally-web')?.typecheck).toEqual(
      expect.stringContaining('tsconfig.app.json'),
    );
    expect(repoCommands('ally-ai')?.typecheck).toBeUndefined();
    expect(repoCommands('ally-ai-learn')?.typecheck).toBeUndefined();
    expect(repoCommands('ally-mobile')?.typecheck).toBeUndefined();
  });

  it("ally-web's typecheck command chains all three project configs with &&, so any one failing stops it", () => {
    const typecheck = BUG_HUNT_REPOS['ally-web'].typecheck as string;
    expect(typecheck.split('&&').map((s) => s.trim())).toEqual([
      'npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json',
      'npx tsc --noEmit -p apps/ally-helpline-dashboard/tsconfig.app.json',
      'npx tsc --noEmit -p libs/ui-shared/tsconfig.lib.json',
    ]);
  });
});
