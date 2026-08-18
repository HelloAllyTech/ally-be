import { BugHunterMode } from '../../enum/bug-finding.enum';
import { BUG_HUNT_MAX_AUTO_MERGES_PER_RUN } from '../bug-hunter.constants';
import { buildSweepPrompt } from '../bug-hunt-sweep-prompt';

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

    it('demands three independent refutation attempts, defaulting to refuted', () => {
      const p = build();
      expect(p).toMatch(/three times, independently, to REFUTE/i);
      expect(p).toMatch(/Default to refuted/i);
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

  describe('merge policy', () => {
    it('states the per-run auto-merge cap from the shared constant', () => {
      expect(build()).toContain(String(BUG_HUNT_MAX_AUTO_MERGES_PER_RUN));
    });

    it('never permits merging a guarded path', () => {
      expect(build()).toMatch(/touchesGuardedPath=false/);
    });

    it('forbids tagging a release or deploying', () => {
      // The human release click is the whole point of the two-stage design.
      expect(build()).toMatch(/Never tag a release and never deploy/i);
    });

    it('tells the agent not to merge something borderline', () => {
      expect(build()).toMatch(/borderline/i);
    });
  });

  describe('a repo that can be swept but not fixed', () => {
    const mobile = () => build({ repo: 'ally-mobile' });

    it('still runs the finders — recording the bug is the job there', () => {
      expect(mobile()).toMatch(/TEST\/LINT/);
      expect(mobile()).toMatch(/PRODUCTION LOGS/);
    });

    it('forbids writing code, branching or opening a PR', () => {
      expect(mobile()).toMatch(
        /Do NOT write code, open a branch, or open a PR/i,
      );
    });

    it('omits the fix steps and the merge policy entirely', () => {
      const p = mobile();
      expect(p).not.toMatch(/gh pr merge/);
      expect(p).not.toMatch(/Apply the MINIMAL fix/);
      expect(p).not.toContain('pipeline/approved-findings');
    });

    it('still closes the run', () => {
      expect(mobile()).toContain('/close');
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
});
