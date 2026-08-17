import { buildFixSessionPrompt } from '../bug-fix-prompt';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';

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
    expect(() => build({}, 'ally-mobile')).toThrow(/no test\/lint commands/i);
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

  // ── cross-repo guard ─────────────────────────────────────────────────────

  it('stops a fix that spans repos instead of landing half of it', () => {
    const prompt = build();

    expect(prompt).toMatch(/ONLY this repo checked out/);
    expect(prompt).toMatch(/merged half-fix is worse than no fix/);
    expect(prompt).toMatch(/WITHOUT committing anything/);
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
});
