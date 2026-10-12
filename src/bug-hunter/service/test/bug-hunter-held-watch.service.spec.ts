import { BugHunterHeldWatchService } from '../bug-hunter-held-watch.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    source: BugFindingSource.REPORTED_BUG,
    title: 'Tooltips stay in English',
    status: BugFindingStatus.RELEASED,
    prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/792',
    releasedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    metadata: {},
    ...over,
  }) as BugFinding;

describe('BugHunterHeldWatchService', () => {
  let github: { listCommitsSince: jest.Mock };
  let repo: { find: jest.Mock };
  let wrongFix: { record: jest.Mock; findShippedByPr: jest.Mock };
  let verify: { dispatchHeldCheck: jest.Mock };
  let notify: { notify: jest.Mock };
  let service: BugHunterHeldWatchService;

  beforeEach(() => {
    github = {
      listCommitsSince: jest.fn().mockImplementation((repo: string) =>
        Promise.resolve(
          repo === 'ally-web'
            ? [
                {
                  sha: 'deadbeef0001',
                  message:
                    'Revert "fix(i18n): untranslated tooltips in helpline app (#792)"\n\nThis reverts commit 7e509917.',
                  authorLogin: 'shubhambhoite502',
                },
                {
                  sha: 'cafe00000002',
                  message: 'feat: unrelated (#793)',
                  authorLogin: 'someone',
                },
              ]
            : [],
        ),
      ),
    };
    repo = { find: jest.fn().mockResolvedValue([]) };
    wrongFix = {
      record: jest.fn().mockResolvedValue(undefined),
      findShippedByPr: jest
        .fn()
        .mockImplementation((_repo: string, n: number) =>
          Promise.resolve(n === 792 ? finding() : null),
        ),
    };
    verify = {
      dispatchHeldCheck: jest.fn().mockResolvedValue({ findingIds: ['f-1'] }),
    };
    notify = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new BugHunterHeldWatchService(
      github as never,
      repo as never,
      wrongFix as never,
      verify as never,
      notify as never,
    );
  });

  it('turns a revert of a Bug Hunter PR on master into a reopened bug with the broken link and a message', async () => {
    expect(await service.watchReverts()).toBe(1);
    expect(wrongFix.record).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f-1' }),
      expect.objectContaining({
        link: 'held',
        source: 'revert',
        sha: 'deadbeef0001',
        by: 'shubhambhoite502',
        reason: expect.stringContaining('Reverted on master in deadbee'),
      }),
      { reopen: true },
    );
    expect(notify.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'f-1',
        title: expect.stringContaining('My fix was reverted'),
      }),
    );
  });

  it('records a revert once, and reads past a repo GitHub cannot list', async () => {
    wrongFix.findShippedByPr.mockResolvedValue(
      finding({
        metadata: {
          wrongFix: { sha: 'deadbeef0001', link: 'held', source: 'revert' },
        },
      }),
    );
    expect(await service.watchReverts()).toBe(0);
    github.listCommitsSince.mockRejectedValue(new Error('rate limited'));
    expect(await service.watchReverts()).toBe(0);
  });

  it('sends the Verifier to production for released human reports an hour on, once each', async () => {
    repo.find.mockResolvedValue([
      finding(),
      finding({ id: 'f-2', metadata: { heldInProduction: { ok: true } } }),
      finding({ id: 'f-3', metadata: { heldCheckRunId: 'run-x' } }),
    ]);
    expect(await service.checkHeld()).toBe(1);
    expect(verify.dispatchHeldCheck).toHaveBeenCalledTimes(1);
    expect(verify.dispatchHeldCheck).toHaveBeenCalledWith('f-1');
  });
});
