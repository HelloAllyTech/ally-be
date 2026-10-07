import { BugCaseFileService, collectVerdicts } from '../bug-case-file.service';
import { BugCaseBudgetService } from '../bug-case-budget.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugHuntEvent } from '../../entity/bug-hunt-event.entity';
import {
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BUG_CASE_BUDGET_DEFAULTS } from '../../type/bug-case-budget.type';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    source: BugFindingSource.CODE_REVIEW,
    status: BugFindingStatus.NEW,
    title: 'Settings buttons stay in English',
    description: 'With Marathi selected the Settings buttons stay in English.',
    originalDescription: null,
    file: 'apps/x/Settings.tsx',
    symbol: null,
    severity: null,
    proven: false,
    evidence: null,
    touchesGuardedPath: false,
    prUrl: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    metadata: {},
    budget: null,
    ...overrides,
  }) as BugFinding;

const event = (overrides: Partial<BugHuntEvent>): BugHuntEvent =>
  ({
    id: 'e',
    runId: 'run-1',
    repo: 'ally-web',
    stage: BugHuntEventStage.FIX_ATTEMPT,
    summary: '',
    payload: null,
    findingId: 'f-1',
    createdAt: new Date('2026-10-01T11:00:00Z'),
    ...overrides,
  }) as BugHuntEvent;

describe('collectVerdicts', () => {
  it('turns stored verifier votes into finding verdicts, stamped from the verify event', () => {
    const f = finding({
      metadata: {
        confidence: 0.6,
        verifierVotes: [
          { refuted: false, certainty: 0.9, reason: 'reproduced' },
          { refuted: false, certainty: 0.6, reason: 'plausible' },
        ],
      },
    });
    const verdicts = collectVerdicts(f, [
      event({
        stage: BugHuntEventStage.VERIFY,
        runId: 'sweep-1',
        summary: 'both accepted',
        createdAt: new Date('2026-10-01T06:00:00Z'),
      }),
    ]);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({
      kind: 'finding',
      verdict: 'confirmed',
      confidence: 0.9,
      reason: 'reproduced',
      runId: 'sweep-1',
    });
    expect(verdicts[0].at?.toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('records an engine that could not verify as an unavailable verdict', () => {
    const f = finding({ metadata: { verificationUnavailable: true } });
    const verdicts = collectVerdicts(f, [
      event({
        stage: BugHuntEventStage.VERIFY,
        summary: 'verification unavailable on Gemini',
      }),
    ]);
    expect(verdicts).toEqual([
      expect.objectContaining({
        verdict: 'unavailable',
        reason: 'verification unavailable on Gemini',
      }),
    ]);
  });

  it('counts a dismissal by verification as a refutation, but not a human decision', () => {
    const verdicts = collectVerdicts(finding(), [
      event({
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary: 'Dismissed by verification.',
        payload: { decisionNote: 'guard upstream', confidence: 0.85 },
      }),
      event({
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary: 'User 1 rejected this bug (duplicate).',
        payload: { decidedBy: 1 },
      }),
    ]);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      verdict: 'refuted',
      reason: 'guard upstream',
      confidence: 0.85,
    });
  });
});

describe('BugCaseFileService.build', () => {
  const events = [
    event({
      stage: BugHuntEventStage.SESSION_DISPATCHED,
      createdAt: new Date('2026-10-01T10:30:00Z'),
    }),
    event({
      stage: BugHuntEventStage.FIX_ATTEMPT,
      payload: {
        attempt: 1,
        hypothesis: 'missing keys',
        changedFiles: ['mr.json'],
        check: 'regression test',
        result: 'failed',
        failure: '385 blank values',
      },
      createdAt: new Date('2026-10-01T10:40:00Z'),
    }),
    event({
      stage: BugHuntEventStage.PR_OPENED,
      summary: 'opened a PR',
      createdAt: new Date('2026-10-01T10:50:00Z'),
    }),
  ];

  const build = (f: BugFinding) => {
    const eventRepository = {
      listForFinding: jest.fn().mockResolvedValue(events),
    };
    const bugFindingService = {
      enrich: jest.fn().mockResolvedValue([
        {
          ...f,
          report: {
            reporterSource: 'staff',
            reportedByName: 'Gayatri',
            reportedAt: new Date('2026-10-01T09:00:00Z'),
            reporterContext: { route: '/settings' },
          },
        },
      ]),
    };
    const budgetService = new BugCaseBudgetService({} as never);
    const service = new BugCaseFileService(
      eventRepository as never,
      bugFindingService as never,
      budgetService,
      { listForFinding: jest.fn().mockResolvedValue([]) } as never,
    );
    return { service, eventRepository, bugFindingService };
  };

  it('assembles sessions, attempts, budget, lineage, miss and totals from the finding and its timeline', async () => {
    const f = finding({
      source: BugFindingSource.REPORTED_BUG,
      metadata: {
        rediscoveredCount: 2,
        regressionOf: 'older',
        postmortem: { attempts: 2 },
        miss: { reason: 'no_sense', sense: 'locale_parity', rationale: 'r' },
      },
      budget: { used: { sessions: 1 } },
    });
    const { service } = build(f);

    const cf = await service.build(f);

    expect(cf.finding).toMatchObject({ id: 'f-1', repo: 'ally-web' });
    expect(cf.reporter).toMatchObject({ source: 'staff', name: 'Gayatri' });
    expect(cf.sessions).toHaveLength(1);
    expect(cf.sessions[0].attempts[0]).toMatchObject({
      attempt: 1,
      failure: '385 blank values',
    });
    expect(cf.sessions[0].outcome).toBe('with a PR open');
    expect(cf.lineage).toEqual({
      regressionOf: 'older',
      regressed: false,
      rediscoveredCount: 2,
    });
    expect(cf.postmortem).toEqual({ attempts: 2 });
    expect(cf.miss?.sense).toBe('locale_parity');
    expect(cf.budget.used.sessions).toBe(1);
    expect(cf.budget.caps).toEqual(BUG_CASE_BUDGET_DEFAULTS);
    expect(cf.decisions).toEqual([]);
    expect(cf.totals).toEqual({ sessions: 1, attempts: 1, verdicts: 0 });
  });

  it('leaves the current run out of the sessions and uses events handed in rather than fetching', async () => {
    const f = finding();
    const { service, eventRepository } = build(f);

    const cf = await service.build(f, { currentRunId: 'run-1', events });

    expect(cf.sessions).toEqual([]);
    expect(eventRepository.listForFinding).not.toHaveBeenCalled();
  });

  it('still returns a case file when the reporter lookup fails', async () => {
    const f = finding({ source: BugFindingSource.REPORTED_BUG });
    const { service, bugFindingService } = build(f);
    bugFindingService.enrich.mockRejectedValue(new Error('db down'));

    const cf = await service.build(f);

    expect(cf.reporter).toBeNull();
    expect(cf.sessions).toHaveLength(1);
  });
});
