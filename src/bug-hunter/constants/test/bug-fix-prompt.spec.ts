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

  it('tells an ordinary fix to merge behind the PR checks, and not to deploy', () => {
    // ally-ai-learn is the one repo whose master is unprotected, so it is the
    // only place the bot can actually land its own work.
    const prompt = build({ repo: 'ally-ai-learn' }, 'ally-ai-learn');

    expect(prompt).toContain('gh pr merge --squash');
    expect(prompt).toContain('gh pr checks --watch');
    expect(prompt).toMatch(/do NOT tag a release or deploy/i);
  });

  it('never INSTRUCTS a merge with --admin, on any repo', () => {
    // `--admin` bypasses the PR's own run, and on the one repo where merging
    // is possible that run is the only second opinion between an agent's diff
    // and master. Asserted across every repo because this is the instruction
    // that silently made the CI gate optional.
    //
    // Every mention has to be NEGATED rather than absent: the prompt still
    // names `--admin` in order to forbid it ("Do NOT use ...") and to explain
    // why it would fail on a protected repo ("... has no admin rights to
    // bypass it with"). The negation sits before the mention in one and after
    // it in the other, so the window spans both sides.
    for (const repo of [
      'ally-be',
      'ally-web',
      'ally-ai',
      'ally-ai-learn',
      'ally-mobile',
    ]) {
      const prompt = build({ repo }, repo);
      const contexts = [
        ...prompt.matchAll(/(.{0,60}gh pr merge --admin.{0,60})/gi),
      ].map((match) => match[1]);

      for (const context of contexts) {
        expect(context).toMatch(/\b(?:not|never|no)\b/i);
      }
    }
  });

  it('tells the one mergeable repo explicitly not to use --admin', () => {
    expect(build({ repo: 'ally-ai-learn' }, 'ally-ai-learn')).toMatch(
      /Do NOT use "gh pr merge --admin"/i,
    );
  });

  it('tells a fix on a protected repo that it cannot merge, and why', () => {
    // The failure this replaces: the protocol said "merge it", the bot has
    // push access against a master that wants a review, and both fix sessions
    // inspected on 2026-09-02 spent half an hour and ended with a green PR
    // and an apology. Saying so up front makes a green PR the intended
    // outcome rather than a fallback the agent discovers at step 9.
    const prompt = build({}, 'ally-be');

    expect(prompt).toMatch(/Do NOT attempt to merge/i);
    expect(prompt).toMatch(/push access only/i);
    expect(prompt).toMatch(/one click to merge/i);
  });

  it('forbids merging a guarded-path fix', () => {
    const prompt = build({ touchesGuardedPath: true }, 'ally-ai-learn');

    expect(prompt).toMatch(/Do NOT merge/);
    expect(prompt).toMatch(/guarded path/i);
    expect(prompt).not.toContain('gh pr merge --squash');
  });

  it('still flags the guarded path on a repo the bot cannot merge to at all', () => {
    // ally-be, ally-web and ally-ai all have canBotMerge: false, so a
    // guarded-path finding on any of them hit the "cannot merge here" branch
    // before ever reaching the guarded-path-specific one — the reviewer got
    // told the bot has no merge rights but never which sensitive area to look
    // at, even though the finding genuinely touches one.
    for (const repo of ['ally-be', 'ally-web', 'ally-ai']) {
      const prompt = build({ touchesGuardedPath: true }, repo);

      expect(prompt).toMatch(/Do NOT attempt to merge/i);
      expect(prompt).toMatch(/guarded path/i);
      expect(prompt).toMatch(/which guarded area it touches/i);
    }
  });

  it('never merges an ally-mobile fix, guarded path or not', () => {
    // ally-mobile IS fixable — Bug Hunter opens a PR there — but this pipeline
    // only runs Jest, which cannot verify the native/on-device behaviour that
    // actually ships, so a human always merges it.
    //
    // ally-mobile also has `canBotMerge: false`, so two rules forbid this
    // merge. The MOBILE one has to be the reason the agent is given: the
    // platform reason is permanent product policy, the permissions one could
    // change tomorrow, and telling the agent the wrong one would invite it to
    // treat a frozen-build risk as an access problem.
    const prompt = build({ touchesGuardedPath: false }, 'ally-mobile');

    expect(prompt).toMatch(/Do NOT merge/);
    expect(prompt).not.toContain('gh pr merge');
    expect(prompt).toMatch(/ally-mobile fixes always stay a reviewed PR/i);
    expect(prompt).not.toMatch(/push access only/i);
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

  it('skips the duplicated hook on every path, now that the PR run is always the gate', () => {
    // This flipped deliberately. The hook used to be mandatory on the
    // auto-merge path because `gh pr merge --admin` walked past the PR's own
    // checks, making the hook the last place the suite ran before master. Step
    // 9 now waits for those checks instead, so on every path the PR's run is
    // the gate and the hook is a second run of a suite the agent already ran
    // itself — several minutes each time, on ally-be roughly 6,500 tests, and
    // the commonest way a session approached its 60-minute cap.
    for (const [repo, over] of [
      ['ally-ai-learn', {}],
      ['ally-be', {}],
      ['ally-ai-learn', { touchesGuardedPath: true }],
      ['ally-mobile', {}],
    ] as const) {
      const prompt = build(over, repo);
      expect(prompt).toMatch(/git commit --no-verify/);
      expect(prompt).not.toMatch(/Do not pass `--no-verify`/);
    }
  });

  it('still refuses to skip the hook when the agent never got a clean run', () => {
    // The one condition under which the hook is worth its minutes.
    expect(build({}, 'ally-be')).toMatch(
      /If you did NOT get a clean run at step 5, do not skip the hook/i,
    );
  });
});
