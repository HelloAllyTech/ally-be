import { BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import {
  BUG_HUNT_LOW_CONFIDENCE_THRESHOLD,
  BUG_HUNT_MAX_AUTO_MERGES_PER_RUN,
  BUG_HUNT_VERIFIER_SUBAGENT,
} from '../bug-hunter.constants';
import { buildSweepPrompt } from '../bug-hunt-sweep-prompt';
import { stageMentions } from './stage-mentions';

const build = (over: Partial<Parameters<typeof buildSweepPrompt>[0]> = {}) =>
  buildSweepPrompt({
    repo: 'ally-be',
    runId: 'run-1',
    apiBaseUrl: 'https://api.example.com',
    mode: BugHunterMode.AI,
    deep: false,
    ...over,
  });

/**
 * Asserts the *content* of the sweep protocol, in the same spirit as
 * bug-fix-prompt.spec.ts: this text is the only definition of what an
 * unattended sweep does, and a silently-dropped instruction is a behaviour
 * change nothing else would catch.
 */
describe('buildSweepPrompt', () => {
  it('refuses a repo it has no commands for, rather than emitting an unverifiable protocol', () => {
    expect(() => build({ repo: 'not-an-ally-repo' })).toThrow(
      /no test\/lint commands/i,
    );
  });

  it('embeds that repo’s own test and lint commands', () => {
    expect(build({ repo: 'ally-ai' })).toContain('poetry run pytest');
    expect(build({ repo: 'ally-be' })).toContain('npm test');
  });

  describe('all four finders are always present', () => {
    it.each([
      ['test/lint', /TEST\/LINT/],
      ['code review', /CODE REVIEW/],
      ['production logs', /PRODUCTION LOGS/],
      ['reported bugs', /REPORTED BUGS/],
    ])('includes the %s finder', (_name, pattern) => {
      expect(build()).toMatch(pattern);
    });
  });

  it('scopes the code review to the last day by default', () => {
    expect(build({ deep: false })).toContain("git log --since='1 day ago'");
  });

  it('reads the whole repo only when deep is asked for', () => {
    const deep = build({ deep: true });
    expect(deep).toContain('Read broadly across the codebase');
    expect(deep).not.toContain("git log --since='1 day ago'");
  });

  it('asks for a symbol on every finding, and says why', () => {
    // Without this the dedupe key falls back to a prose fingerprint, which is
    // the fuzzy path — see BugFindingRepository.dedupeKey.
    const p = build();
    expect(p).toContain('symbol is the function');
    expect(p).toMatch(/duplicate row/i);
  });

  it('tells the agent NOT to dedupe against previous runs itself', () => {
    // The server does it, and an agent second-guessing that would fragment a
    // bug's history across rows.
    expect(build()).toMatch(/do NOT need to dedupe against previous runs/i);
  });

  describe('verification', () => {
    it('skips proven findings', () => {
      expect(build()).toMatch(/proven=true skip this phase/i);
    });

    it('gets its verdicts from independent verifiers rather than self-checking', () => {
      // This replaced "try three times, independently, to REFUTE it" —
      // wording that read as independence but described the SAME agent
      // re-reading its own finding three times. The real thing is delegation;
      // the detail is asserted in the "verification is independent" block.
      const p = build();
      expect(p).toMatch(/TWO INDEPENDENT verdicts/i);
      expect(p).toMatch(/Do NOT judge these findings yourself/i);
    });
  });

  describe('mode gating', () => {
    it('in MANUAL, stops at pending_approval and fixes nothing found tonight', () => {
      const p = build({ mode: BugHunterMode.MANUAL });
      expect(p).toContain('pending_approval');
      expect(p).toMatch(/do NOT fix anything you found tonight/i);
    });

    it('in AI, surviving findings are the agent’s to fix', () => {
      expect(build({ mode: BugHunterMode.AI })).toMatch(/yours to fix/i);
    });

    it('picks up previously-approved findings whatever the current mode', () => {
      // Approval once given should not evaporate because the switch moved.
      for (const mode of [BugHunterMode.AI, BugHunterMode.MANUAL]) {
        expect(build({ mode })).toContain('pipeline/approved-findings');
      }
    });
  });

  describe('verification is independent, and scored', () => {
    it('delegates each verdict to the verifier subagent instead of self-checking', () => {
      // The property this restores. `bug-hunt.mjs` always ran three
      // independent `agent()` calls; the CI prompt that replaced it said "try
      // three times to refute it yourself", which is the same agent re-reading
      // its own argument — last night that produced "I personally read the
      // code for all 9 and confirmed 8" with nothing to calibrate it against.
      const p = build();
      expect(p).toContain(BUG_HUNT_VERIFIER_SUBAGENT);
      expect(p).toMatch(/Do NOT judge these findings yourself/i);
      expect(p).toMatch(/never saw your reasoning/i);
    });

    it('withholds the finder’s reasoning from the verifiers', () => {
      // The verifier's whole value is what it has not been told.
      expect(build()).toMatch(/never your rationale/i);
    });

    it('dismisses on a single refutation, and says why that asymmetry is deliberate', () => {
      const p = build();
      expect(p).toMatch(/If EITHER verifier refutes it, dismiss it/i);
      expect(p).toMatch(/false positive costs a reviewer their trust/i);
    });

    it('requires a decision reason on every dismissal', () => {
      // Without one, the dismissal teaches the next sweep nothing and the
      // accuracy figure has no denominator.
      const p = build();
      expect(p).toMatch(/decisionReason is REQUIRED/i);
      expect(p).toContain('not_a_bug');
      expect(p).toContain('wrong_repo');
    });

    it('takes the lower of two certainties, not the average', () => {
      expect(build()).toMatch(/The LOWER, not the average/i);
    });

    it('holds a low-confidence survivor for a human even in AI mode', () => {
      const p = build({ mode: BugHunterMode.AI });
      expect(p).toContain(String(BUG_HUNT_LOW_CONFIDENCE_THRESHOLD));
      expect(p).toMatch(/pending_approval/);
    });

    it('still skips verification for proven findings', () => {
      expect(build()).toMatch(/proven=true skip this phase/i);
    });
  });

  describe('known non-bugs', () => {
    const declined = [
      {
        title: 'useFieldAutosave retries forever',
        file: 'src/hooks/useFieldAutosave.ts',
        symbol: 'useFieldAutosave',
        reason: 'not_a_bug',
        note: "the code's own comment documents unlimited retry as intended",
      },
    ];

    it('says nothing at all when there is nothing settled', () => {
      // A heading with an empty list under it is prompt weight for no
      // information, and this text competes with the protocol it precedes.
      expect(build({ knownNonBugs: [] })).not.toMatch(/Already settled/i);
    });

    it('lists what reviewers already ruled out, with the reason', () => {
      const p = build({ knownNonBugs: declined });
      expect(p).toMatch(/Already settled/i);
      expect(p).toContain('useFieldAutosave retries forever');
      expect(p).toContain('not_a_bug');
      expect(p).toContain('intended');
    });

    it('tells the agent its own reading is the thing more likely to be wrong', () => {
      expect(build({ knownNonBugs: declined })).toMatch(
        /your reading is wrong, not that the reviewer was/i,
      );
    });

    it('still leaves room to re-file with an explanation', () => {
      // A permanent veto would be wrong: code changes underneath a decision.
      expect(build({ knownNonBugs: declined })).toMatch(
        /you may still report it/i,
      );
    });

    it('clips a long title rather than letting one entry dominate', () => {
      const p = build({
        knownNonBugs: [
          { title: 'x'.repeat(400), reason: 'not_a_bug', note: null },
        ],
      });
      expect(p).toContain('…');
      expect(p).not.toContain('x'.repeat(300));
    });

    it('collapses a multi-line note into one bullet', () => {
      const p = build({
        knownNonBugs: [
          {
            title: 'Something',
            reason: 'wont_fix',
            note: 'first line\n\nsecond line',
          },
        ],
      });
      expect(p).toContain('first line second line');
    });
  });

  describe('merge policy', () => {
    // ally-ai-learn is the only repo where the bot can actually land a merge
    // (unprotected master), so it is the only place the auto-merge rules are
    // reachable — see BUG_HUNT_REPOS.canBotMerge.
    const mergeable = () => build({ repo: 'ally-ai-learn' });

    it('states the per-run auto-merge cap from the shared constant', () => {
      expect(mergeable()).toContain(String(BUG_HUNT_MAX_AUTO_MERGES_PER_RUN));
    });

    it('never permits merging a guarded path', () => {
      expect(mergeable()).toMatch(/touchesGuardedPath=false/);
    });

    it('forbids tagging a release or deploying', () => {
      // The human release click is the whole point of the two-stage design.
      expect(build()).toMatch(/Never tag a release and never deploy/i);
    });

    it('tells the agent not to merge something borderline', () => {
      expect(mergeable()).toMatch(/borderline/i);
    });

    it('merges behind the PR checks, never with --admin', () => {
      const p = mergeable();
      expect(p).toContain('gh pr checks --watch');
      expect(p).toContain('gh pr merge --squash');
      expect(p).not.toContain('gh pr merge --admin');
    });

    it('tells a protected repo it cannot merge, separately from the mobile rule', () => {
      // Same fix as in the fix-session prompt: the sweep spent its Fix phase
      // opening PRs and then failing at a merge its token could never perform.
      const p = build({ repo: 'ally-be' });
      expect(p).toMatch(/Do not attempt to merge anything here/i);
      expect(p).toMatch(/push access only/i);
      expect(p).not.toMatch(/you may merge at most/i);
      // The mobile reasoning must not leak onto a backend repo.
      expect(p).not.toMatch(/frozen contract/i);
    });
  });

  describe('ally-mobile: fixable, but never merged', () => {
    const mobile = (
      over: Partial<Parameters<typeof buildSweepPrompt>[0]> = {},
    ) => build({ repo: 'ally-mobile', ...over });

    it('still runs the finders and the fix phase, unlike a genuinely unfixable repo', () => {
      expect(mobile()).toMatch(/TEST\/LINT/);
      expect(mobile()).toMatch(/Apply the MINIMAL fix/);
      expect(mobile()).toContain('pipeline/approved-findings');
    });

    it('forbids merging, however trivial the fix', () => {
      const p = mobile();
      expect(p).toMatch(/Never merge here/i);
      expect(p).not.toContain('gh pr merge --admin');
      expect(p).not.toMatch(/you may merge at most/i);
      expect(p).not.toMatch(/genuinely trivial/i);
    });

    it('still closes the run', () => {
      expect(mobile()).toContain('/close');
    });
  });

  describe('the progress stages it advertises', () => {
    const valid = new Set<string>(Object.values(BugHuntEventStage));

    // Every branch of the prompt: the text differs by mode and by repo, so a
    // bad stage hiding in one arm has to fail here too.
    const variants: [
      string,
      Parameters<typeof buildSweepPrompt>[0]['repo'],
      BugHunterMode,
    ][] = [
      ['ally-be, AI', 'ally-be', BugHunterMode.AI],
      ['ally-be, MANUAL', 'ally-be', BugHunterMode.MANUAL],
      ['ally-mobile (never merges)', 'ally-mobile', BugHunterMode.AI],
      ['ally-ai', 'ally-ai', BugHunterMode.AI],
      ['ally-web (unfixable)', 'ally-web', BugHunterMode.AI],
    ];

    it.each(variants)(
      'names only stages BugHuntEventStage defines — %s',
      (_label, repo, mode) => {
        const mentioned = stageMentions(build({ repo, mode }));
        // Guards the extractor itself: a regex that silently stops matching
        // would make this whole suite pass vacuously.
        expect(mentioned.length).toBeGreaterThan(5);
        expect(mentioned.filter((stage) => !valid.has(stage))).toEqual([]);
      },
    );

    it('calls the verify stage `verify`, not `verify_result`', () => {
      // The actual regression: `verify_result` is not a BugHuntEventStage, so
      // the CHECK constraint rejected every Phase-2 report and the sweep's
      // verification work left no trace in the run timeline.
      expect(stageMentions(build())).toContain(BugHuntEventStage.VERIFY);
      expect(build()).not.toContain('verify_result');
    });

    it('asks for a verify report on every finding, accepted or dismissed', () => {
      // Widened deliberately: a finding the verifiers ACCEPTED is now worth a
      // report too, because its confidence score is the thing a reader needs
      // and there was previously no event carrying it.
      expect(build()).toMatch(/Report a verify stage per finding either way/i);
    });
  });

  it('requires the run to be closed exactly once, even on an empty sweep', () => {
    // A run left open looks to an admin like a sweep still working.
    const p = build();
    expect(p).toMatch(/Exactly once, whatever happened/i);
    expect(p).toMatch(/found nothing at all/i);
  });

  it('addresses every callback to the run it was given', () => {
    const p = build({ runId: 'abc-123' });
    expect(p).toContain('/runs/abc-123/findings');
    expect(p).toContain('/runs/abc-123/report');
    expect(p).toContain('/runs/abc-123/close');
  });

  // ── one-shot runtime ─────────────────────────────────────────────────────
  //
  // `claude -p` exits 0 whenever the agent produces a final response. A fix
  // session backgrounded its pre-commit-hooked `git commit`, said it would
  // push "once it finishes", and ended its turn — the runner died with the
  // work in its tree and the job stayed green. The sweep commits in the same
  // way, once per fix, across a 300-turn run, so it is exposed to the same
  // mistake more often rather than less.

  it('tells the agent it gets one process and no second chance', () => {
    const p = build();

    expect(p).toMatch(/single non-interactive process/i);
    expect(p).toMatch(/NEVER start a long command in the background/i);
  });

  it('quotes the sweep job’s own budget, not the fix session’s', () => {
    // The two workflows cap differently — 120 vs 60 — and a sweep told it has
    // an hour would ration work it has time for.
    expect(build()).toMatch(/120 minutes is the real budget/);
  });

  it('warns that a commit runs the full suite and is not a hang', () => {
    expect(build()).toMatch(
      /pre-commit hook that re-runs lint and the whole suite/i,
    );
    expect(build()).toMatch(/NOT a hang/);
  });

  it('warns that the workflow fails the job on a run left open', () => {
    expect(build()).toMatch(/re-reads this run the moment you exit/i);
    expect(build()).toMatch(/fails the job if it is still open/i);
  });
});
