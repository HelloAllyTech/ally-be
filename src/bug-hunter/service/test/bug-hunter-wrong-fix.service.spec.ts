import { BugHunterWrongFixService } from '../bug-hunter-wrong-fix.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    title: 'Simulation titles stay in English with Marathi selected',
    status: BugFindingStatus.RELEASED,
    prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
    metadata: { confidence: 0.9 },
    updatedAt: new Date(),
    ...over,
  }) as BugFinding;

describe('BugHunterWrongFixService', () => {
  let rows: BugFinding[];
  let repo: { findOne: jest.Mock; update: jest.Mock; find: jest.Mock };
  let hunter: { appendFindingEvent: jest.Mock };
  let memory: { write: jest.Mock };
  let service: BugHunterWrongFixService;

  beforeEach(() => {
    rows = [finding()];
    repo = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
        ),
      update: jest.fn().mockImplementation((id, patch) => {
        rows = rows.map((r) =>
          r.id === id ? ({ ...r, ...patch } as BugFinding) : r,
        );
        return Promise.resolve();
      }),
      find: jest.fn().mockImplementation(() => Promise.resolve(rows)),
    };
    hunter = { appendFindingEvent: jest.fn().mockResolvedValue(undefined) };
    memory = { write: jest.fn().mockResolvedValue({ id: 'm-1' }) };
    service = new BugHunterWrongFixService(
      repo as never,
      hunter as never,
      memory as never,
    );
  });

  it('records the broken link, writes a lesson for the notebook, and reopens the bug when asked', async () => {
    await service.record(
      finding(),
      {
        link: 'held',
        source: 'revert',
        reason:
          'Reverted on master in abc1234: "Revert \\"fix(i18n): tooltips (#798)\\"".',
        prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
        sha: 'abc1234def',
        by: 'shubhambhoite502',
      },
      { reopen: true },
    );
    const row = rows[0];
    expect(row.status).toBe(BugFindingStatus.NEW);
    expect(row.metadata?.wrongFix).toMatchObject({
      link: 'held',
      source: 'revert',
      sha: 'abc1234def',
      by: 'shubhambhoite502',
    });
    // The rest of the metadata survives.
    expect(row.metadata?.confidence).toBe(0.9);
    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: BugHuntEventStage.WRONG_FIX,
        summary: expect.stringMatching(/A person reverted my fix .* reopened/),
      }),
    );
    const lesson = memory.write.mock.calls[0][0];
    expect(lesson.tags).toEqual(['wrong-fix', 'fix-gotcha', 'link:held']);
    expect(lesson.repos).toEqual(['ally-web']);
    expect(lesson.body.length).toBeLessThanOrEqual(600);
    expect(lesson.body).toMatch(
      /re-run the reporter's steps at the PR head and again after release/,
    );
  });

  it('leaves the status alone for a Verifier refusal, and tells the next session to locate first', async () => {
    rows = [finding({ status: BugFindingStatus.PR_OPENED })];
    await service.record(
      rows[0],
      {
        link: 'changed',
        source: 'verifier',
        reason: 'the fault is in data and the change is in locale_file',
        prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
        sha: null,
        by: 'gemini-2.5-pro',
      },
      { reopen: false },
    );
    expect(rows[0].status).toBe(BugFindingStatus.PR_OPENED);
    expect(memory.write.mock.calls[0][0].body).toMatch(
      /locate the fault in production first/,
    );
  });

  it('never throws: a failed write is a warning, not a failed verdict', async () => {
    repo.update.mockRejectedValue(new Error('db down'));
    await expect(
      service.record(
        finding(),
        {
          link: 'held',
          source: 'regression',
          reason: 'back',
          prUrl: null,
          sha: null,
          by: null,
        },
        { reopen: false },
      ),
    ).resolves.toBeUndefined();
  });

  it('summarises the window per link and per source, newest first', async () => {
    const at = new Date().toISOString();
    rows = [
      finding({
        id: 'a',
        metadata: {
          wrongFix: { link: 'changed', source: 'verifier', reason: 'r1', at },
        },
      }),
      finding({
        id: 'b',
        metadata: {
          wrongFix: { link: 'held', source: 'revert', reason: 'r2', at },
        },
      }),
      finding({
        id: 'c',
        metadata: {
          wrongFix: {
            link: 'held',
            source: 'revert',
            reason: 'old',
            at: '2020-01-01T00:00:00.000Z',
          },
        },
      }),
      finding({ id: 'd', metadata: {} }),
    ];
    const s = await service.summary(30);
    expect(s.total).toBe(2);
    expect(s.byLink).toMatchObject({ changed: 1, held: 1, observed: 0 });
    expect(s.bySource).toMatchObject({ verifier: 1, revert: 1, regression: 0 });
    expect(s.recent.map((r) => r.findingId)).toEqual(['a', 'b']);
  });

  it('finds the shipped finding behind a PR number in a repo', async () => {
    rows = [
      finding({
        id: 'x',
        prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/79',
      }),
      finding({
        id: 'y',
        prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
      }),
    ];
    expect((await service.findShippedByPr('ally-web', 798))?.id).toBe('y');
    expect(await service.findShippedByPr('ally-web', 7)).toBeNull();
  });
});
