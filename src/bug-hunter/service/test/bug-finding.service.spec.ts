import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { BUG_HUNTER_AGENT_ROADMAP_OWNER } from '../../constants/bug-fix-session.constants';
import { BugFindingRepository } from '../../repository/bug-finding.repository';
import { BugFindingService, RawFinding } from '../bug-finding.service';
import { BugHunterNotificationService } from '../bug-hunter-notification.service';
import { BugHunterService } from '../bug-hunter.service';

import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES,
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../../enum/bug-hunter-notification.enum';

const RUN = 'run-1';
const REPO = 'ally-be';

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  source: BugFindingSource.CODE_REVIEW,
  file: 'src/a.ts',
  description: 'The retry loop never resets the counter, so it retries forever',
  proven: false,
  touchesGuardedPath: false,
  severity: BugFindingSeverity.MEDIUM,
  ...over,
});

const row = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'existing-1',
    repo: REPO,
    source: BugFindingSource.CODE_REVIEW,
    file: 'src/a.ts',
    symbol: null,
    description: raw().description,
    status: BugFindingStatus.NEW,
    proven: false,
    touchesGuardedPath: false,
    ...over,
  }) as BugFinding;

/**
 * Only `editDescription` writes to the event timeline, so everything else gets
 * a stub that would fail loudly if it were ever called with the wrong shape.
 */
const bugHunterService = (
  over: Partial<{ appendFindingEvent: jest.Mock }> = {},
) =>
  ({
    appendFindingEvent: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as BugHunterService;

/** Nothing under test here touches the roadmap unless a finding merges. */
const roadmapRepository = (
  over: Partial<{ findOne: jest.Mock; update: jest.Mock }> = {},
) =>
  ({
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as Repository<RoadmapOpportunity>;

describe('BugFindingService.persistFindings', () => {
  let service: BugFindingService;
  let repo: jest.Mocked<
    Pick<
      BugFindingRepository,
      | 'findByReportedBugId'
      | 'listStaleNeedsInput'
      | 'findOpenByDedupeKey'
      | 'update'
      | 'save'
      | 'create'
      | 'findOne'
    >
  >;

  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };

  beforeEach(() => {
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    repo = {
      findByReportedBugId: jest.fn().mockResolvedValue(null),
      listStaleNeedsInput: jest.fn().mockResolvedValue([]),
      findOpenByDedupeKey: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((v) => v),
      save: jest
        .fn()
        .mockImplementation((v) => Promise.resolve({ id: 'new-1', ...v })),
      findOne: jest.fn().mockResolvedValue(row()),
    } as never;

    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmapRepository(),
      bugHunterService(),
    );
  });

  it('inserts a genuinely new finding at NEW', async () => {
    const [saved] = await service.persistFindings(RUN, REPO, [raw()]);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(saved.status).toBe(BugFindingStatus.NEW);
  });

  it('persists the symbol the finder supplied', async () => {
    await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'retryLoop' }),
    );
  });

  it('touches the existing open row instead of duplicating it', async () => {
    repo.findOpenByDedupeKey.mockResolvedValue(row());
    await service.persistFindings(RUN, REPO, [raw()]);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('existing-1', { runId: RUN });
  });

  describe('the symbol transition', () => {
    /**
     * A row stored before its finder learned to emit `symbol` is keyed on the
     * description fingerprint. Once the finder DOES supply one, the precise key
     * cannot match that row — and without a second lookup we would open a
     * duplicate for a bug we already have, which is the exact failure the
     * reworked dedupe key exists to prevent.
     */
    it('adopts a symbol-less row when the rediscovery names a symbol', async () => {
      repo.findOpenByDedupeKey
        .mockResolvedValueOnce(null) // precise, symbol-keyed lookup misses
        .mockResolvedValueOnce(row()); // symbol-less fallback key hits

      await service.persistFindings(RUN, REPO, [raw({ symbol: 'retryLoop' })]);

      expect(repo.findOpenByDedupeKey).toHaveBeenCalledTimes(2);
      expect(repo.save).not.toHaveBeenCalled();
      // Re-keyed as well as annotated, so the next sweep matches first time
      // rather than re-walking this transition every night.
      expect(repo.update).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({
          runId: RUN,
          symbol: 'retryLoop',
          dedupeKey: expect.any(String),
        }),
      );
    });

    it('does NOT look for a fallback row when the finding has no symbol', async () => {
      // The fingerprint is the fuzzy half; letting a symbol-less finding claim a
      // precisely-keyed row would merge two distinct bugs.
      await service.persistFindings(RUN, REPO, [raw()]);
      expect(repo.findOpenByDedupeKey).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('never overwrites a symbol already on the row', async () => {
      repo.findOpenByDedupeKey.mockResolvedValue(
        row({ symbol: 'alreadyKnown' }),
      );
      await service.persistFindings(RUN, REPO, [
        raw({ symbol: 'somethingElse' }),
      ]);
      expect(repo.update).toHaveBeenCalledWith('existing-1', { runId: RUN });
    });
  });

  describe('reported bugs', () => {
    it('updates the row created at roadmap-intake time, never re-inserting', async () => {
      repo.findByReportedBugId.mockResolvedValue(
        row({ id: 'reported-1', source: BugFindingSource.REPORTED_BUG }),
      );
      await service.persistFindings(RUN, REPO, [
        raw({ source: BugFindingSource.REPORTED_BUG, reportedBugId: 'rb-1' }),
      ]);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.findOpenByDedupeKey).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'reported-1',
        expect.objectContaining({ runId: RUN, repo: REPO }),
      );
    });

    it('falls through to normal dedup when the reported row has gone', async () => {
      repo.findByReportedBugId.mockResolvedValue(null);
      await service.persistFindings(RUN, REPO, [
        raw({
          source: BugFindingSource.REPORTED_BUG,
          reportedBugId: 'rb-gone',
        }),
      ]);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  it('returns rows in input order so the pipeline can zip ids back', async () => {
    repo.save
      .mockResolvedValueOnce({ id: 'first' } as never)
      .mockResolvedValueOnce({ id: 'second' } as never);
    const out = await service.persistFindings(RUN, REPO, [
      raw({ description: 'counter never resets' }),
      raw({ description: 'timezone applied twice' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['first', 'second']);
  });
});

/**
 * The stale-question digest exists because the inbox is pull-only by design:
 * an unattended sweep asks a question and moves on, so without something to
 * resurface it the bug stops progressing and nobody knows it is waiting on
 * them.
 */
describe('BugFindingService.raiseStaleEscalationDigest', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = new Date('2026-08-18T12:00:00Z');
  const stale = (over: Partial<BugFinding> = {}): BugFinding =>
    row({
      status: BugFindingStatus.NEEDS_INPUT,
      escalationQuestion: 'Should a suspended tenant still see this?',
      updatedAt: new Date('2026-08-16T12:00:00Z'),
      ...over,
    });

  let service: BugFindingService;
  let repo: { listStaleNeedsInput: jest.Mock };
  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };

  beforeEach(() => {
    repo = { listStaleNeedsInput: jest.fn().mockResolvedValue([]) };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmapRepository(),
      bugHunterService(),
    );
  });

  const run = () =>
    service.raiseStaleEscalationDigest(4 * HOUR, 24 * HOUR, NOW);

  it('says nothing when no question is waiting', async () => {
    // A quiet, successful night produces no message — the inbox's own rule.
    await expect(run()).resolves.toEqual({ notified: false, staleCount: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('only considers questions older than the stale window', async () => {
    await run();
    expect(repo.listStaleNeedsInput).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 4 * HOUR),
    );
  });

  it('raises one action_needed message covering all of them', async () => {
    // One message, not one per finding: nine action_needed rows would bury the
    // badge they are meant to light up.
    repo.listStaleNeedsInput.mockResolvedValue([
      stale({ title: 'Suspended tenant sees archived cases' }),
      stale({ title: 'Counsellor list ignores tenant filter' }),
    ]);

    await expect(run()).resolves.toEqual({ notified: true, staleCount: 2 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);

    const [args] = notifications.notify.mock.calls[0];
    expect(args.level).toBe(BugHunterNotificationLevel.ACTION_NEEDED);
    expect(args.body).toContain('Suspended tenant sees archived cases');
    expect(args.body).toContain('Counsellor list ignores tenant filter');
    expect(args.body).toContain('2 bugs');
  });

  it('pins the message to no single finding', async () => {
    // It is about several bugs; a findingId would make the row open the wrong
    // drawer.
    repo.listStaleNeedsInput.mockResolvedValue([stale(), stale()]);
    await run();
    expect(notifications.notify.mock.calls[0][0].findingId).toBeNull();
  });

  it('reports the age of the oldest, which the query returns first', async () => {
    repo.listStaleNeedsInput.mockResolvedValue([
      stale({ updatedAt: new Date('2026-08-15T12:00:00Z') }), // 3 days
      stale({ updatedAt: new Date('2026-08-17T12:00:00Z') }),
    ]);
    await run();
    expect(notifications.notify.mock.calls[0][0].body).toContain('3 days');
  });

  it('stays quiet if it already said this within the quiet period', async () => {
    // Repeating it daily is a nudge; hourly is what turns an inbox into
    // wallpaper.
    repo.listStaleNeedsInput.mockResolvedValue([stale()]);
    notifications.wasRaisedSince.mockResolvedValue(true);

    await expect(run()).resolves.toEqual({ notified: false, staleCount: 1 });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.wasRaisedSince).toHaveBeenCalledWith(
      expect.any(String),
      new Date(NOW.getTime() - 24 * HOUR),
    );
  });

  it('uses singular wording for a single waiting bug', async () => {
    repo.listStaleNeedsInput.mockResolvedValue([stale()]);
    await run();
    expect(notifications.notify.mock.calls[0][0].body).toContain('one bug');
  });
});

/**
 * This is the path a fix agent takes on the common single-repo run: it runs
 * `gh pr merge --admin` itself and then PATCHes the finding to `merged`. If the
 * bug came in through the Product Roadmap, that merge is the moment the
 * reporter's card should move to Released — nothing else asks GitHub about that
 * PR afterwards, so a card missed here is a card that stays wrong forever.
 */
describe('BugFindingService.setStatus — releasing the reporter’s roadmap card', () => {
  const merged = (over: Partial<BugFinding> = {}): BugFinding =>
    row({
      id: 'finding-1',
      status: BugFindingStatus.MERGED,
      reportedBugId: 'opportunity-1',
      ...over,
    });

  let service: BugFindingService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let notifications: { notify: jest.Mock; wasRaisedSince: jest.Mock };
  let roadmap: { findOne: jest.Mock; update: jest.Mock };

  const build = () => {
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      notifications as unknown as BugHunterNotificationService,
      roadmap as unknown as Repository<RoadmapOpportunity>,
      bugHunterService(),
    );
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(merged()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      wasRaisedSince: jest.fn().mockResolvedValue(false),
    };
    roadmap = {
      findOne: jest.fn().mockResolvedValue({
        id: 'opportunity-1',
        stage: RoadmapOpportunityStage.NEW,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    build();
  });

  it('releases the linked opportunity when the fix agent reports its own merge', async () => {
    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.findOne).toHaveBeenCalledWith({
      where: { id: 'opportunity-1' },
    });
    expect(roadmap.update).toHaveBeenCalledWith('opportunity-1', {
      stage: RoadmapOpportunityStage.RELEASED,
      owner: BUG_HUNTER_AGENT_ROADMAP_OWNER,
      ownerUserId: null,
      releasedAt: expect.any(Date),
    });
  });

  it('does not re-stamp releasedAt on an already-released card', async () => {
    roadmap.findOne.mockResolvedValue({
      id: 'opportunity-1',
      stage: RoadmapOpportunityStage.RELEASED,
    });

    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.update).toHaveBeenCalledWith('opportunity-1', {
      stage: RoadmapOpportunityStage.RELEASED,
      owner: BUG_HUNTER_AGENT_ROADMAP_OWNER,
      ownerUserId: null,
    });
  });

  it('leaves the roadmap alone for a sweep finding nobody reported', async () => {
    repo.findOne.mockResolvedValue(merged({ reportedBugId: null }));

    await service.setStatus('finding-1', { status: BugFindingStatus.MERGED });

    expect(roadmap.findOne).not.toHaveBeenCalled();
    expect(roadmap.update).not.toHaveBeenCalled();
  });

  it('leaves the card where it is on any other transition', async () => {
    // pr_opened is the guarded-path handoff: the fix has NOT landed yet, so
    // telling the reporter it shipped would be a lie the reconcile pass would
    // only correct once a human merges.
    repo.findOne.mockResolvedValue(
      merged({ status: BugFindingStatus.PR_OPENED }),
    );

    await service.setStatus('finding-1', {
      status: BugFindingStatus.PR_OPENED,
      prUrl: 'https://github.com/helloallytech/ally-be/pull/1',
    });

    expect(roadmap.update).not.toHaveBeenCalled();
  });

  it('still reports the finding as MERGED when the roadmap write fails', async () => {
    // Best-effort: the status transition is already committed, so a roadmap
    // outage must not turn a merged fix into a failed PATCH.
    roadmap.findOne.mockRejectedValue(new Error('connection reset'));

    const after = await service.setStatus('finding-1', {
      status: BugFindingStatus.MERGED,
    });

    expect(after.status).toBe(BugFindingStatus.MERGED);
    expect(repo.update).toHaveBeenCalledWith('finding-1', {
      status: BugFindingStatus.MERGED,
    });
  });
});

/**
 * An admin rewriting the brief before a fix session runs.
 *
 * What these lock down is not the write — it is the three things the write
 * must leave alone. The description is the fix agent's whole statement of the
 * problem, so an edit that quietly moved the status, lost the finder's
 * original words, or left no trace on the timeline would each remove the
 * ability to answer the only question worth asking after a bad fix: was the
 * agent wrong, or was it told the wrong thing?
 */
describe('BugFindingService.editDescription', () => {
  const EDITOR = 42;
  const NEXT =
    'Searching for a counsellor by phone number returns nobody, even for a number that exists — the query compares the raw input against a normalised column.';

  let service: BugFindingService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let hunter: { appendFindingEvent: jest.Mock };

  const build = (finding: BugFinding) => {
    repo = {
      findOne: jest.fn().mockResolvedValue(finding),
      update: jest.fn().mockResolvedValue(undefined),
    };
    hunter = { appendFindingEvent: jest.fn().mockResolvedValue(undefined) };
    service = new BugFindingService(
      repo as unknown as BugFindingRepository,
      {
        notify: jest.fn(),
        wasRaisedSince: jest.fn(),
      } as unknown as BugHunterNotificationService,
      roadmapRepository(),
      hunter as unknown as BugHunterService,
    );
  };

  it('rewrites the description and keeps the original words', async () => {
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.objectContaining({
        description: NEXT,
        originalDescription: 'search is broken',
        descriptionEditedBy: EDITOR,
      }),
    );
  });

  it('never overwrites the original with a previous admin’s rewrite', async () => {
    // Second edit: `originalDescription` is already set, and it is the
    // finder's text — not the version being replaced right now.
    build(
      row({
        id: 'finding-1',
        description: 'first rewrite',
        originalDescription: 'what the finder actually said',
      }),
    );

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.objectContaining({
        originalDescription: 'what the finder actually said',
      }),
    );
  });

  it('does not move the status — editing is not approving', async () => {
    build(row({ id: 'finding-1', status: BugFindingStatus.PENDING_APPROVAL }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(repo.update).toHaveBeenCalledWith(
      'finding-1',
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it('records the rewrite on the finding’s own timeline, with both versions', async () => {
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await service.editDescription('finding-1', NEXT, EDITOR);

    expect(hunter.appendFindingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 'finding-1',
        stage: BugHuntEventStage.DESCRIPTION_EDITED,
        payload: expect.objectContaining({
          from: 'search is broken',
          to: NEXT,
        }),
      }),
    );
  });

  it('trims, and treats an unchanged description as nothing to do', async () => {
    build(row({ id: 'finding-1', description: NEXT }));

    await service.editDescription('finding-1', `  ${NEXT}  `, EDITOR);

    expect(repo.update).not.toHaveBeenCalled();
    // No work log row either: a "description edited" entry saying nothing
    // changed is noise on a timeline whose job is explaining a fix session.
    expect(hunter.appendFindingEvent).not.toHaveBeenCalled();
  });

  it('refuses a blank rewrite outright', async () => {
    // Regression: `@IsNotEmpty` accepts "   ", so the DTO alone let a
    // whitespace-only PATCH through and stored an empty brief — a fix session
    // asked to fix nothing. The invariant belongs here as well as in the pipe.
    build(row({ id: 'finding-1', description: 'search is broken' }));

    await expect(
      service.editDescription('finding-1', '   \n  ', EDITOR),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each([
    BugFindingStatus.QUEUED,
    BugFindingStatus.FIXING,
    BugFindingStatus.MERGED,
    BugFindingStatus.RELEASED,
    BugFindingStatus.REJECTED,
  ])('refuses to edit a finding that is %s', async (status) => {
    build(row({ id: 'finding-1', status }));

    await expect(
      service.editDescription('finding-1', NEXT, EDITOR),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES)(
    'allows an edit from %s — the same statuses "Put me on it" is offered from',
    async (status) => {
      build(row({ id: 'finding-1', status, description: 'vague' }));

      await expect(
        service.editDescription('finding-1', NEXT, EDITOR),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalled();
    },
  );
});
