import { buildFixSessionPrompt } from '../bug-fix-prompt';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { stageMentions } from './stage-mentions';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'finding-1',
    repo: 'ally-be',
    title: 'Terms link is not formatted correctly',
    description: 'The external emergency-services link renders unstyled.',
    file: 'src/app.ts',
    evidence: null,
    touchesGuardedPath: false,
    escalationAnswer: null,
    status: BugFindingStatus.NEW,
    ...overrides,
  }) as BugFinding;

const build = (overrides: Partial<BugFinding> = {}, repo = 'ally-be') =>
  buildFixSessionPrompt({
    finding: finding(overrides),
    repo,
    runId: 'run-1',
    apiBaseUrl: 'https://api.example.com',
  });

describe('buildFixSessionPrompt', () => {
  it('carries the bug, the repo commands and the callback URLs', () => {
    const prompt = build();

    expect(prompt).toContain(
      'The external emergency-services link renders unstyled.',
    );
    expect(prompt).toContain('npm test');
    expect(prompt).toContain(
      'https://api.example.com/api/v1/bug-hunter/runs/run-1/report',
    );
  });

  it('uses the repo argument, not the finding, to pick test commands', () => {
    // The admin can send an untriaged bug to a repo the finding does not name
    // yet — the session must run that repo's suite, not ally-be's.
    expect(build({ repo: null }, 'ally-ai')).toContain('poetry run pytest');
  });

  it('throws rather than emitting a prompt with no way to verify a fix', () => {
    expect(() => build({}, 'not-an-ally-repo')).toThrow(
      /no test\/lint commands/i,
    );
  });

  // ── merge policy ─────────────────────────────────────────────────────────

  it('tells an ordinary fix to merge, and not to deploy', () => {
    const prompt = build();

    expect(prompt).toContain('gh pr merge --admin');
    expect(prompt).toMatch(/do NOT tag a release or deploy/i);
  });

  it('forbids merging a guarded-path fix', () => {
    const prompt = build({ touchesGuardedPath: true });

    expect(prompt).toMatch(/Do NOT merge/);
    expect(prompt).not.toContain('gh pr merge --admin');
  });

  it('never merges an ally-mobile fix, guarded path or not', () => {
    // ally-mobile IS fixable — Bug Hunter opens a PR there — but this pipeline
    // only runs Jest, which cannot verify the native/on-device behaviour that
    // actually ships, so a human always merges it.
    const prompt = build({ touchesGuardedPath: false }, 'ally-mobile');

    expect(prompt).toMatch(/Do NOT merge/);
    expect(prompt).not.toContain('gh pr merge --admin');
    expect(prompt).toMatch(/ally-mobile fixes always stay a reviewed PR/i);
  });

  // ── cross-repo guard ─────────────────────────────────────────────────────

  it('stops a fix that spans repos instead of landing half of it', () => {
    const prompt = build();

    expect(prompt).toMatch(/ONLY this repo checked out/);
    expect(prompt).toMatch(/merged half-fix is worse than no fix/);
    expect(prompt).toMatch(/WITHOUT committing anything/);
  });

  // ── progress stages ──────────────────────────────────────────────────────

  describe('the progress stages it advertises', () => {
    const valid = new Set<string>(Object.values(BugHuntEventStage));

    // Same guard as bug-hunt-sweep-prompt.spec.ts, where the drift actually
    // happened: this prompt hands the agent stage strings as prose and as
    // pre-baked curl bodies, and the accepting end is an enum plus a CHECK
    // constraint that nothing compiled them against.
    it.each([
      ['ally-be', 'ally-be'],
      ['ally-ai', 'ally-ai'],
      ['ally-mobile', 'ally-mobile'],
    ])('names only stages BugHuntEventStage defines — %s', (_label, repo) => {
      const mentioned = stageMentions(build({}, repo));
      expect(mentioned.length).toBeGreaterThan(5);
      expect(mentioned.filter((stage) => !valid.has(stage))).toEqual([]);
    });

    it('bakes a real stage into every pre-built report curl', () => {
      const baked = [...build().matchAll(/"stage":"([a-z_]+)"/g)].map(
        (m) => m[1],
      );
      expect(baked.length).toBeGreaterThan(0);
      expect(baked.filter((stage) => !valid.has(stage))).toEqual([]);
    });
  });

  // ── resumed sessions ─────────────────────────────────────────────────────

  it('replays an answer the admin already gave, so it is not asked twice', () => {
    const prompt = build({
      escalationAnswer: 'Show the raw URL as a fallback.',
    });

    expect(prompt).toContain('Show the raw URL as a fallback.');
    expect(prompt).toMatch(/do not ask it again/i);
  });

  it('tells the agent to find the file itself when the bug names none', () => {
    expect(build({ file: null })).toMatch(
      /not identified — locate it yourself/,
    );
  });

  // ── one-shot runtime ─────────────────────────────────────────────────────
  //
  // A live session backgrounded its `git commit`, announced it would push
  // "once it finishes", and ended its turn. `claude -p` exited 0, the runner
  // was destroyed with the work still in its tree, and the job stayed green.
  // The prompt now has to say that ending a turn IS the end.

  it('tells the agent it gets one process and no second chance', () => {
    const prompt = build();

    expect(prompt).toMatch(/single non-interactive process/i);
    expect(prompt).toMatch(/NEVER start a long command in the background/i);
    expect(prompt).toMatch(/60 minutes is the real budget/);
  });

  it('requires a terminal status before the agent may stop', () => {
    const prompt = build();

    expect(prompt).toMatch(/must be OUT of "fixing"/i);
    expect(prompt).toMatch(/fails the job if it is still "fixing"/i);
  });

  // ── the pre-commit hook ──────────────────────────────────────────────────

  it('forbids --no-verify on a fix it is about to admin-merge', () => {
    // `gh pr merge --admin` walks past the PR's own checks (master has
    // enforce_admins: false), so the commit hook is the last place the suite
    // runs against this diff before it reaches master.
    const prompt = build();

    expect(prompt).toMatch(/Do not pass `--no-verify`/);
    expect(prompt).toMatch(/last time the suite runs against your diff/i);
  });

  it('skips the duplicated hook on a fix that stays an open PR', () => {
    // Nothing merges without CI and a reviewer here, so re-running a suite the
    // agent already ran at step 5 buys nothing.
    for (const prompt of [
      build({ touchesGuardedPath: true }),
      build({ touchesGuardedPath: false }, 'ally-mobile'),
    ]) {
      expect(prompt).toMatch(/git commit --no-verify/);
      expect(prompt).not.toMatch(/Do not pass `--no-verify`/);
    }
  });
});
